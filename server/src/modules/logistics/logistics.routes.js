import { Router } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { notify, notifyOps } from '../../lib/workflow.js';
import { completeJob } from '../../lib/completion.js';
import { createOrder, recordMovement } from '../../lib/logistics.js';
import { PRIVATE_DIR, removeFiles, saveFile, uploadMedia } from '../../lib/uploads.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

// Collection and delivery (requirements section 9). Mounted at the API root.
const router = Router();
const ops = [authenticate, requireRole('OPERATIONS_ADMIN')];
const field = [authenticate, requireRole('LOGISTICS_PERSONNEL', 'OPERATIONS_ADMIN')];
const isOps = (user) => user.roles.includes('OPERATIONS_ADMIN') || user.roles.includes('SUPER_ADMIN');
const OPEN = ['CREATED', 'ASSIGNED', 'EN_ROUTE'];

const nameOf = async (id) => (await prisma.user.findUnique({ where: { id }, select: { fullName: true } }))?.fullName ?? 'Staff';
// Date-time pickers send local Kampala time, for example 2026-11-25T10:00.
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Choose a date and time').transform((v) => new Date(`${v}:00+03:00`));

const ORDER_CONTEXT = {
  job: {
    include: {
      workshop: true,
      booking: { include: { service: { select: { name: true } }, device: true, address: true, customer: { select: { userId: true, user: { select: { fullName: true, phone: true } } } } } },
    },
  },
};

async function loadOrder(req, id) {
  const order = await prisma.collectionDeliveryOrder.findUnique({ where: { id }, include: ORDER_CONTEXT });
  if (!order || (!isOps(req.user) && order.assignedPersonId !== req.user.id)) throw new ApiError(404, 'Order not found');
  return order;
}

// ───────── 9.2 Operations: assignment ─────────
router.get('/admin/logistics/orders', ...ops, asyncHandler(async (req, res) => {
  const orders = await prisma.collectionDeliveryOrder.findMany({
    where: req.query.status === 'all' ? {} : { status: { in: [...OPEN, 'FAILED'] } },
    orderBy: { createdAt: 'asc' }, take: 100,
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 3 }, job: { select: { status: true, booking: { select: { reference: true, service: { select: { name: true } }, device: { select: { brand: true, model: true, category: true } } } } } } },
  });
  const people = await prisma.user.findMany({ where: { id: { in: orders.map((o) => o.assignedPersonId).filter(Boolean) } }, select: { id: true, fullName: true, phone: true } });
  const by = Object.fromEntries(people.map((p) => [p.id, p]));
  ok(res, orders.map((o) => ({ ...o, transportCharge: Number(o.transportCharge), person: o.assignedPersonId ? by[o.assignedPersonId] ?? null : null })));
}));

router.get('/admin/logistics/personnel', ...ops, asyncHandler(async (_req, res) => {
  ok(res, await prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { name: 'LOGISTICS_PERSONNEL' } } } }, select: { id: true, fullName: true, phone: true } }));
}));

router.post('/admin/logistics/orders/:id/assign', ...ops, asyncHandler(async (req, res) => {
  const body = z.object({
    personId: z.string().uuid(),
    scheduledAt: localTime.optional(),
    transportCharge: z.coerce.number().nonnegative().max(5_000_000).optional(),
    instructions: z.string().trim().max(500).optional(),
  }).parse(req.body);
  const order = await prisma.collectionDeliveryOrder.findUnique({ where: { id: req.params.id }, include: ORDER_CONTEXT });
  if (!order) throw new ApiError(404, 'Order not found');
  if (!['CREATED', 'FAILED'].includes(order.status)) throw new ApiError(409, 'This order is already assigned or finished.');
  if (order.orderType === 'DELIVERY' && order.job.status !== 'READY_FOR_HANDOVER') throw new ApiError(409, 'The device must be released from the workshop before delivery.');
  const person = await prisma.user.findFirst({ where: { id: body.personId, status: 'ACTIVE', roles: { some: { role: { name: 'LOGISTICS_PERSONNEL' } } } }, select: { id: true, fullName: true } });
  if (!person) throw new ApiError(422, 'Validation failed', [{ field: 'personId', message: 'Choose an active collection and delivery person' }]);
  await prisma.$transaction(async (tx) => {
    await tx.collectionDeliveryOrder.update({
      where: { id: order.id },
      data: { assignedPersonId: person.id, status: 'ASSIGNED', scheduledAt: body.scheduledAt ?? order.scheduledAt, transportCharge: body.transportCharge ?? order.transportCharge, instructions: body.instructions ?? order.instructions },
    });
    const what = order.orderType === 'COLLECTION' ? 'collection' : 'delivery';
    await notify(tx, person.id, `New ${what} assigned`, `${order.reference}: ${order.pickupAddress} to ${order.destinationAddress}.`, 'LOGISTICS_ASSIGNED');
    await notify(tx, order.job.booking.customer.userId, `Your ${what} is arranged`, `${person.fullName} will handle the ${what} for ${order.job.booking.reference}${body.scheduledAt ? ` on ${body.scheduledAt.toLocaleString('en-UG', { timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' })}` : ''}.`, 'LOGISTICS_ARRANGED');
    await audit(tx, { userId: req.user.id, action: 'LOGISTICS_ASSIGNED', entityType: 'CollectionDeliveryOrder', entityId: order.id, newValues: { personId: person.id }, ip: req.ip });
  });
  ok(res, { status: 'ASSIGNED' }, 'Assigned');
}));

// Delivery orders are normally created at release. Operations can create one for a job that is ready.
router.post('/admin/logistics/orders', ...ops, asyncHandler(async (req, res) => {
  const { jobId } = z.object({ jobId: z.string().uuid() }).parse(req.body);
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { workshop: true, booking: { include: { device: true, address: true, customer: { select: { user: { select: { fullName: true, phone: true } } } } } } } });
  if (!job?.workshop) throw new ApiError(404, 'Job not found');
  if (job.status !== 'READY_FOR_HANDOVER' || job.booking.fulfilmentMethod !== 'COLLECTION_DELIVERY') throw new ApiError(409, 'Only a repaired device awaiting delivery can have a delivery order.');
  if (await prisma.collectionDeliveryOrder.findFirst({ where: { jobId, orderType: 'DELIVERY', status: { in: OPEN } } })) throw new ApiError(409, 'There is already an open delivery order for this job.');
  const order = await createOrder(prisma, { job, workshop: job.workshop, orderType: 'DELIVERY' });
  ok(res, order, 'Delivery order created', 201);
}));

// ───────── 9.3 Personnel: my orders and field actions ─────────
router.get('/logistics/orders', ...field, asyncHandler(async (req, res) => {
  const where = isOps(req.user) ? { status: { in: ['ASSIGNED', 'EN_ROUTE'] } } : { assignedPersonId: req.user.id, status: { in: ['ASSIGNED', 'EN_ROUTE'] } };
  const orders = await prisma.collectionDeliveryOrder.findMany({
    where, orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    include: { attempts: { orderBy: { createdAt: 'desc' }, take: 2 }, job: { select: { reference: true, booking: { select: { reference: true, service: { select: { name: true } } } } } } },
  });
  ok(res, orders.map((o) => ({ ...o, transportCharge: Number(o.transportCharge) })));
}));

router.post('/logistics/orders/:id/start', ...field, asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  if (order.status !== 'ASSIGNED') throw new ApiError(409, 'This order cannot be started now.');
  const { job } = order;
  if (order.orderType === 'DELIVERY' && job.status !== 'READY_FOR_HANDOVER') throw new ApiError(409, 'The device has not been released for delivery.');
  const me = await nameOf(req.user.id);
  await prisma.$transaction(async (tx) => {
    await tx.collectionDeliveryOrder.update({ where: { id: order.id }, data: { status: 'EN_ROUTE', dispatchedAt: new Date() } });
    if (order.orderType === 'DELIVERY') {
      const releaser = job.workshop?.managerUserId ?? req.user.id;
      await recordMovement(tx, {
        jobId: job.id, type: 'DISPATCHED_FOR_DELIVERY', from: job.workshop?.name ?? 'Workshop', to: `With ${me}`,
        releasingId: releaser, releasingName: releaser === req.user.id ? 'Workshop' : await nameOf(releaser),
        receivingId: req.user.id, receivingName: me, conditionBefore: order.conditionRecorded, accessories: order.accessories, acknowledgedBy: me,
      });
    }
    await notify(tx, job.booking.customer.userId, order.orderType === 'COLLECTION' ? 'Collector on the way' : 'Your device is on its way', `${me} is on the way for booking ${job.booking.reference}.`, 'LOGISTICS_EN_ROUTE');
  });
  ok(res, { status: 'EN_ROUTE' }, 'On the way');
}));

const confirmSchema = z.object({
  jobReference: z.string().trim().min(3, 'Enter the job reference you were given'),
  condition: z.string().trim().min(3, 'Record the condition').max(1000),
  accessories: z.string().trim().min(2, 'List the accessories, or write None').max(500),
  acknowledgedBy: z.string().trim().min(2, 'Enter the name of the person who signed').max(120),
  acknowledged: z.preprocess((v) => v === true || v === 'true', z.boolean()).refine((v) => v, 'The customer must acknowledge'),
});

router.post('/logistics/orders/:id/confirm', ...field, uploadMedia.array('photos', 4), asyncHandler(async (req, res) => {
  const body = confirmSchema.parse(req.body);
  const order = await loadOrder(req, req.params.id);
  if (order.status !== 'EN_ROUTE') throw new ApiError(409, 'Start the trip before confirming.');
  const { job } = order;
  const refs = [job.booking.reference, job.reference].filter(Boolean).map((r) => r.toLowerCase());
  if (!refs.includes(body.jobReference.toLowerCase())) throw new ApiError(422, 'Validation failed', [{ field: 'jobReference', message: 'That reference does not match this job. Check with the customer.' }]);
  const delivery = order.orderType === 'DELIVERY';
  if (delivery && job.status !== 'READY_FOR_HANDOVER') throw new ApiError(409, 'The device has not been released for delivery.');

  const dir = path.join(PRIVATE_DIR, 'jobs');
  const saved = [];
  try {
    for (const f of req.files || []) saved.push((await saveFile(f, dir, { allow: ['IMAGE'], field: 'photos', label: 'Each photo' })).name);
    const me = await nameOf(req.user.id);
    await prisma.$transaction(async (tx) => {
      await tx.collectionDeliveryOrder.update({
        where: { id: order.id },
        data: { status: delivery ? 'DELIVERED' : 'COLLECTED', [delivery ? 'deliveredAt' : 'collectedAt']: new Date(), conditionRecorded: body.condition, accessories: body.accessories, acknowledgedBy: body.acknowledgedBy, customerAcknowledgement: true },
      });
      for (const fileName of saved) await tx.jobPhoto.create({ data: { jobId: job.id, kind: delivery ? 'DELIVERY' : 'COLLECTION', fileName, uploadedById: req.user.id } });
      await recordMovement(tx, {
        jobId: job.id, type: delivery ? 'DELIVERED_TO_CUSTOMER' : 'COLLECTED_FROM_CUSTOMER',
        from: delivery ? `With ${me}` : 'Customer', to: delivery ? 'Customer' : `With ${me}`,
        releasingId: delivery ? req.user.id : job.booking.customer.userId, releasingName: delivery ? me : job.booking.customer.user.fullName,
        receivingId: delivery ? job.booking.customer.userId : req.user.id, receivingName: delivery ? body.acknowledgedBy : me,
        conditionBefore: delivery ? order.conditionRecorded : body.condition, conditionAfter: delivery ? body.condition : null,
        accessories: body.accessories, acknowledgedBy: body.acknowledgedBy,
      });
      if (delivery) {
        await completeJob(tx, job, req.user.id, `Delivered and acknowledged by ${body.acknowledgedBy}`);
        await notify(tx, job.booking.customer.userId, 'Repair complete', `Your device for ${job.booking.reference} was delivered. Thank you for choosing FixPro.`, 'JOB_COMPLETED');
      } else {
        await notify(tx, job.booking.customer.userId, 'Your device was collected', `${me} collected your device for ${job.booking.reference} and is taking it to ${job.workshop?.name ?? 'the workshop'}.`, 'DEVICE_COLLECTED');
        if (job.workshop?.managerUserId) await notify(tx, job.workshop.managerUserId, 'A collected device is arriving', `${job.booking.reference} was collected and is on its way to your workshop.`, 'WORKSHOP_INCOMING');
      }
      await audit(tx, { userId: req.user.id, action: delivery ? 'DELIVERY_CONFIRMED' : 'COLLECTION_CONFIRMED', entityType: 'CollectionDeliveryOrder', entityId: order.id, ip: req.ip });
    });
  } catch (err) {
    await removeFiles(saved.map((n) => path.join(dir, n)));
    throw err;
  }
  ok(res, { status: delivery ? 'DELIVERED' : 'COLLECTED' }, delivery ? 'Delivery confirmed' : 'Collection confirmed');
}));

// ───────── 9.5 Failed collection or delivery ─────────
const failSchema = z.object({
  reason: z.enum(['CUSTOMER_UNAVAILABLE', 'INCORRECT_ADDRESS', 'TRANSPORT_DELAY', 'CUSTOMER_RESCHEDULED', 'DELIVERY_FAILED', 'RETURNED_TO_WORKSHOP']),
  explanation: z.string().trim().min(5, 'Explain what happened').max(1000),
  followUp: z.enum(['RESCHEDULE', 'RETURN_TO_WORKSHOP', 'OPS_REVIEW']),
  rescheduleFor: localTime.optional(),
});

router.post('/logistics/orders/:id/fail', ...field, asyncHandler(async (req, res) => {
  const body = failSchema.parse(req.body);
  if (body.followUp === 'RESCHEDULE' && !body.rescheduleFor) throw new ApiError(422, 'Validation failed', [{ field: 'rescheduleFor', message: 'Choose the new date and time' }]);
  const order = await loadOrder(req, req.params.id);
  if (!['ASSIGNED', 'EN_ROUTE'].includes(order.status)) throw new ApiError(409, 'Only an active order can be reported as failed.');
  const { job } = order;
  const me = await nameOf(req.user.id);
  const wasWithPerson = order.orderType === 'DELIVERY' && order.status === 'EN_ROUTE';
  await prisma.$transaction(async (tx) => {
    await tx.logisticsAttempt.create({ data: { orderId: order.id, reason: body.reason, explanation: body.explanation, followUp: body.followUp, rescheduledFor: body.rescheduleFor, recordedById: req.user.id } });
    const reschedule = body.followUp === 'RESCHEDULE';
    await tx.collectionDeliveryOrder.update({
      where: { id: order.id },
      data: reschedule ? { status: 'ASSIGNED', scheduledAt: body.rescheduleFor, dispatchedAt: null } : { status: 'FAILED' },
    });
    // A device that was already with the delivery person goes back to the workshop's custody on return.
    if (wasWithPerson && body.followUp === 'RETURN_TO_WORKSHOP') {
      await recordMovement(tx, {
        jobId: job.id, type: 'RETURNED_TO_WORKSHOP', from: `With ${me}`, to: job.workshop?.name ?? 'Workshop',
        releasingId: req.user.id, releasingName: me, receivingId: job.workshop?.managerUserId ?? req.user.id, receivingName: job.workshop?.managerUserId ? await nameOf(job.workshop.managerUserId) : 'Workshop',
        conditionBefore: order.conditionRecorded, accessories: order.accessories, acknowledgedBy: me,
      });
    }
    await notifyOps(tx, `${order.orderType === 'COLLECTION' ? 'Collection' : 'Delivery'} problem`, `${order.reference} (${job.booking.reference}): ${body.reason.replaceAll('_', ' ').toLowerCase()}. Follow-up: ${body.followUp.replaceAll('_', ' ').toLowerCase()}.`, 'LOGISTICS_FAILED');
    await notify(tx, job.booking.customer.userId, reschedule ? 'We have rescheduled' : 'We could not complete the trip', reschedule ? `Your ${order.orderType.toLowerCase()} for ${job.booking.reference} is now planned for ${body.rescheduleFor.toLocaleString('en-UG', { timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' })}.` : `We could not complete the ${order.orderType.toLowerCase()} for ${job.booking.reference}. Operations will contact you.`, 'LOGISTICS_UPDATE');
    await audit(tx, { userId: req.user.id, action: 'LOGISTICS_FAILED', entityType: 'CollectionDeliveryOrder', entityId: order.id, newValues: { reason: body.reason, followUp: body.followUp }, ip: req.ip });
  });
  ok(res, { followUp: body.followUp }, 'Recorded');
}));

export default router;
