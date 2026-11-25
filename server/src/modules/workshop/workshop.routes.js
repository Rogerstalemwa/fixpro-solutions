import { Router } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { ACTIVE_ASSIGNMENT, FINAL_JOB, moveJob, notify, notifyOps } from '../../lib/workflow.js';
import { completeJob } from '../../lib/completion.js';
import { readyForHandover } from '../../lib/handover.js';
import { createOrder, deviceText, recordMovement, workshopText } from '../../lib/logistics.js';
import { PRIVATE_DIR, removeFiles, saveFile, uploadMedia } from '../../lib/uploads.js';
import { authenticate, isStaff, requireRole } from '../../middleware/auth.js';

// Workshop management (requirements section 8). Mounted at the API root.
const router = Router();
const ops = [authenticate, requireRole('OPERATIONS_ADMIN')];
const crew = [authenticate, requireRole('WORKSHOP_MANAGER', 'OPERATIONS_ADMIN')];
const isOps = (user) => user.roles.includes('OPERATIONS_ADMIN') || user.roles.includes('SUPER_ADMIN');

const nameOf = async (userId) => (await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }))?.fullName ?? 'Staff';

// ───────── 8.1 Workshop registration (Operations) ─────────
const workshopSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  address: z.string().trim().min(3, 'Enter the location').max(200),
  district: z.string().trim().min(2, 'District is required').max(80),
  contactPerson: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('').transform(() => undefined)),
  operatingHours: z.string().trim().max(120).optional(),
  categoryIds: z.array(z.string().uuid()).max(30).default([]),
  managerUserId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL']).default('ACTIVE'),
});

async function checkManager(userId) {
  if (!userId) return;
  const manager = await prisma.user.findFirst({ where: { id: userId, status: 'ACTIVE', roles: { some: { role: { name: 'WORKSHOP_MANAGER' } } } }, select: { id: true } });
  if (!manager) throw new ApiError(422, 'Validation failed', [{ field: 'managerUserId', message: 'Choose an active user with the workshop manager role' }]);
}

router.get('/admin/workshops', ...ops, asyncHandler(async (_req, res) => {
  const [workshops, managers] = await Promise.all([
    prisma.workshop.findMany({ orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { name: 'WORKSHOP_MANAGER' } } } }, select: { id: true, fullName: true, phone: true } }),
  ]);
  const names = Object.fromEntries(managers.map((m) => [m.id, m.fullName]));
  ok(res, { workshops: workshops.map((w) => ({ ...w, managerName: w.managerUserId ? names[w.managerUserId] ?? null : null })), managers });
}));

router.post('/admin/workshops', ...ops, asyncHandler(async (req, res) => {
  const body = workshopSchema.parse(req.body);
  await checkManager(body.managerUserId);
  const workshop = await prisma.workshop.create({ data: body });
  await audit(prisma, { userId: req.user.id, action: 'WORKSHOP_CREATED', entityType: 'Workshop', entityId: workshop.id, ip: req.ip });
  ok(res, workshop, 'Workshop saved', 201);
}));

router.patch('/admin/workshops/:id', ...ops, asyncHandler(async (req, res) => {
  const body = workshopSchema.partial().parse(req.body);
  await checkManager(body.managerUserId);
  const workshop = await prisma.workshop.update({ where: { id: req.params.id }, data: body });
  await audit(prisma, { userId: req.user.id, action: 'WORKSHOP_UPDATED', entityType: 'Workshop', entityId: workshop.id, newValues: body, ip: req.ip });
  ok(res, workshop, 'Workshop updated');
}));

// ───────── Sending a booking to a workshop (Operations, from the queue) ─────────
router.post('/admin/jobs/:id/route-to-workshop', ...ops, asyncHandler(async (req, res) => {
  const body = z.object({
    workshopId: z.string().uuid(),
    transportCharge: z.coerce.number().nonnegative().max(5_000_000).optional(),
    instructions: z.string().trim().max(500).optional(),
  }).parse(req.body);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { booking: { include: { service: { select: { name: true, categoryId: true } }, device: true, address: true, customer: { select: { userId: true, user: { select: { fullName: true, phone: true } } } } } } },
  });
  if (!job) throw new ApiError(404, 'Job not found');
  if (job.status !== 'AWAITING_ASSIGNMENT') throw new ApiError(409, 'This job is not waiting for assignment.');
  const { booking } = job;
  if (booking.fulfilmentMethod === 'DOORSTEP') throw new ApiError(409, 'This customer asked for a doorstep repair. Assign a technician instead.');
  const workshop = await prisma.workshop.findFirst({ where: { id: body.workshopId, status: 'ACTIVE' } });
  if (!workshop) throw new ApiError(404, 'That workshop is not active');
  if (workshop.categoryIds.length && !workshop.categoryIds.includes(booking.service.categoryId)) {
    throw new ApiError(422, 'Validation failed', [{ field: 'workshopId', message: 'This workshop does not repair that kind of device' }]);
  }
  const collect = booking.fulfilmentMethod === 'COLLECTION_DELIVERY';

  await prisma.$transaction(async (tx) => {
    await tx.job.update({ where: { id: job.id }, data: { assignedWorkshopId: workshop.id } });
    await moveJob(tx, { job, to: 'WORKSHOP_TRANSFER', userId: req.user.id, notes: `Sent to ${workshop.name}` });
    if (collect) await createOrder(tx, { job, workshop, orderType: 'COLLECTION', transportCharge: body.transportCharge ?? 0, instructions: body.instructions });
    await notify(
      tx, booking.customer.userId, collect ? 'We will collect your device' : 'Bring your device to our workshop',
      collect
        ? `Booking ${booking.reference}: we will collect your device and take it to ${workshop.name}. A collection person will be assigned shortly.`
        : `Booking ${booking.reference}: bring your device to ${workshopText(workshop)}.${workshop.operatingHours ? ` Open ${workshop.operatingHours}.` : ''} Quote your booking reference when you arrive.`,
      'WORKSHOP_ROUTED',
    );
    if (workshop.managerUserId) await notify(tx, workshop.managerUserId, 'A device is coming to your workshop', `${booking.reference}: ${deviceText(booking.device)}, ${booking.service.name}.`, 'WORKSHOP_INCOMING');
    await audit(tx, { userId: req.user.id, action: 'JOB_ROUTED_TO_WORKSHOP', entityType: 'Job', entityId: job.id, newValues: { workshopId: workshop.id }, ip: req.ip });
  });
  ok(res, { jobId: job.id, status: 'WORKSHOP_TRANSFER', workshop: workshop.name }, 'Sent to the workshop');
}));

// ───────── Workshop manager access ─────────
// Operations sees every workshop. A manager sees only the workshops they are linked to.
async function managedWorkshops(user) {
  if (isOps(user)) return prisma.workshop.findMany({ orderBy: { name: 'asc' } });
  const mine = await prisma.workshop.findMany({ where: { managerUserId: user.id } });
  if (!mine.length) throw new ApiError(403, 'You are not linked to a workshop yet. Ask Operations to assign you as its manager.');
  return mine;
}

async function loadJob(req, id) {
  const workshops = await managedWorkshops(req.user);
  const job = await prisma.job.findFirst({
    where: { id, assignedWorkshopId: { in: workshops.map((w) => w.id) } },
    include: {
      workshop: true,
      booking: { include: { service: { select: { name: true, categoryId: true } }, device: true, address: true, customer: { select: { userId: true, user: { select: { fullName: true, phone: true } } } } } },
    },
  });
  if (!job) throw new ApiError(404, 'Job not found at your workshop');
  if (FINAL_JOB.includes(job.status)) throw new ApiError(409, `This job is already ${job.status.toLowerCase()}.`);
  return job;
}

router.get('/workshop/me', ...crew, asyncHandler(async (req, res) => {
  ok(res, { workshops: (await managedWorkshops(req.user)).map(({ id, name, address, district, operatingHours }) => ({ id, name, address, district, operatingHours })) });
}));

const STAGE = { WORKSHOP_TRANSFER: 'ARRIVING', INSPECTION: 'DIAGNOSIS', AWAITING_APPROVAL: 'DIAGNOSIS', APPROVED: 'REPAIR', WORKSHOP_REPAIR: 'REPAIR', QUALITY_CHECK: 'QUALITY', READY_FOR_HANDOVER: 'READY' };

router.get('/workshop/jobs', ...crew, asyncHandler(async (req, res) => {
  const workshops = await managedWorkshops(req.user);
  const jobs = await prisma.job.findMany({
    where: { assignedWorkshopId: { in: workshops.map((w) => w.id) }, status: { in: Object.keys(STAGE) } },
    orderBy: { updatedAt: 'asc' },
    include: {
      workshop: { select: { id: true, name: true } },
      booking: { select: { reference: true, fulfilmentMethod: true, faultDescription: true, contactName: true, contactPhone: true, service: { select: { name: true } }, device: true, customer: { select: { user: { select: { fullName: true, phone: true } } } } } },
      assignments: { where: { status: { in: ['ACCEPTED', 'OFFERED'] } }, take: 1, select: { technician: { select: { id: true, user: { select: { fullName: true, phone: true } } } } } },
      quotations: { orderBy: { version: 'desc' }, take: 1, select: { status: true, total: true } },
      serviceReports: { take: 1, select: { id: true } },
      qualityChecks: { orderBy: { createdAt: 'desc' }, take: 1 },
      repairActivities: { orderBy: { createdAt: 'desc' }, take: 6 },
      invoices: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { reference: true, total: true, balance: true, status: true } },
      logisticsOrders: { orderBy: { createdAt: 'desc' }, select: { reference: true, orderType: true, status: true, scheduledAt: true } },
    },
  });
  const received = new Set((await prisma.workshopInspection.findMany({ where: { jobId: { in: jobs.map((j) => j.id) } }, select: { jobId: true } })).map((r) => r.jobId));
  ok(res, jobs.map(({ booking, assignments, quotations, serviceReports, qualityChecks, repairActivities, invoices, logisticsOrders, ...job }) => ({
    id: job.id, reference: job.reference, status: job.status, stage: STAGE[job.status], workshop: job.workshop, updatedAt: job.updatedAt,
    booking, technician: assignments[0]?.technician ? { id: assignments[0].technician.id, ...assignments[0].technician.user } : null,
    quotation: quotations[0] ?? null, hasServiceReport: serviceReports.length > 0, qualityCheck: qualityChecks[0] ?? null,
    activities: repairActivities, invoice: invoices[0] ?? null, orders: logisticsOrders, received: received.has(job.id),
  })));
}));

// Company technicians who can work on this job's service.
router.get('/workshop/jobs/:id/technicians', ...crew, asyncHandler(async (req, res) => {
  const job = await loadJob(req, req.params.id);
  const techs = await prisma.technician.findMany({
    where: { verificationStatus: 'VERIFIED', technicianType: 'COMPANY', user: { status: 'ACTIVE' }, specialisations: { some: { serviceId: job.booking.serviceId } } },
    select: { id: true, user: { select: { fullName: true, phone: true } }, _count: { select: { assignments: { where: { status: { in: ACTIVE_ASSIGNMENT }, job: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } } } } } },
  });
  ok(res, techs.map((t) => ({ id: t.id, fullName: t.user.fullName, phone: t.user.phone, activeJobs: t._count.assignments })).sort((a, b) => a.activeJobs - b.activeJobs));
}));

// ───────── 8.2 Equipment reception ─────────
const receiveSchema = z.object({
  receivedCondition: z.string().trim().min(3, 'Describe the physical condition').max(1000),
  accessoriesReceived: z.string().trim().min(2, 'List the accessories, or write None').max(500),
  existingDamage: z.string().trim().max(1000).optional(),
  serialNumber: z.string().trim().max(120).optional(),
  inspectionNotes: z.string().trim().max(1000).optional(),
});

router.post('/workshop/jobs/:id/receive', ...crew, uploadMedia.array('photos', 6), asyncHandler(async (req, res) => {
  const body = receiveSchema.parse(req.body);
  const job = await loadJob(req, req.params.id);
  if (job.status !== 'WORKSHOP_TRANSFER') throw new ApiError(409, 'This device is not waiting to be received.');
  if (await prisma.workshopInspection.findFirst({ where: { jobId: job.id }, select: { id: true } })) throw new ApiError(409, 'This device has already been received.');

  // Collected equipment is not "received" until this step is completed (8.3).
  const collection = await prisma.collectionDeliveryOrder.findFirst({ where: { jobId: job.id, orderType: 'COLLECTION' }, orderBy: { createdAt: 'desc' } });
  if (job.booking.fulfilmentMethod === 'COLLECTION_DELIVERY' && !(collection && ['COLLECTED', 'IN_TRANSIT'].includes(collection.status))) {
    throw new ApiError(409, 'The device has not been collected from the customer yet.');
  }
  const photos = req.files || [];
  const dir = path.join(PRIVATE_DIR, 'jobs');
  const saved = [];
  try {
    for (const f of photos) saved.push((await saveFile(f, dir, { allow: ['IMAGE'], field: 'photos', label: 'Each photo' })).name);
    const receiver = await nameOf(req.user.id);
    const custodianId = collection?.assignedPersonId ?? job.booking.customer.userId;
    const custodianName = collection?.assignedPersonId ? await nameOf(collection.assignedPersonId) : job.booking.customer.user.fullName;
    await prisma.$transaction(async (tx) => {
      await tx.workshopInspection.create({
        data: {
          jobId: job.id, workshopId: job.workshop.id, receivedCondition: body.receivedCondition, accessoriesReceived: body.accessoriesReceived,
          existingDamage: body.existingDamage, inspectionNotes: [body.serialNumber && `Serial number: ${body.serialNumber}`, body.inspectionNotes].filter(Boolean).join('. ') || null,
          inspectedById: req.user.id,
        },
      });
      for (const fileName of saved) await tx.jobPhoto.create({ data: { jobId: job.id, kind: 'RECEPTION', fileName, uploadedById: req.user.id } });
      await recordMovement(tx, {
        jobId: job.id, type: 'WORKSHOP_RECEIPT', from: collection ? 'In transit from customer' : 'Customer', to: job.workshop.name,
        releasingId: custodianId, releasingName: custodianName, receivingId: req.user.id, receivingName: receiver,
        conditionBefore: body.receivedCondition, accessories: body.accessoriesReceived, acknowledgedBy: receiver,
      });
      if (collection) await tx.collectionDeliveryOrder.update({ where: { id: collection.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      await moveJob(tx, { job, to: 'INSPECTION', userId: req.user.id, notes: `Received at ${job.workshop.name}` });
      await notify(tx, job.booking.customer.userId, 'Your device has reached the workshop', `${job.booking.reference}: ${job.workshop.name} received your device and will diagnose it next.`, 'WORKSHOP_RECEIVED');
      await audit(tx, { userId: req.user.id, action: 'WORKSHOP_RECEIVED', entityType: 'Job', entityId: job.id, ip: req.ip });
    });
  } catch (err) {
    await removeFiles(saved.map((n) => path.join(dir, n)));
    throw err;
  }
  ok(res, { jobId: job.id, status: 'INSPECTION' }, 'Device received', 201);
}));

// ───────── 8.4 Repair management ─────────
router.post('/workshop/jobs/:id/assign-technician', ...crew, asyncHandler(async (req, res) => {
  const { technicianId } = z.object({ technicianId: z.string().uuid() }).parse(req.body);
  const job = await loadJob(req, req.params.id);
  if (!['INSPECTION', 'APPROVED', 'WORKSHOP_REPAIR', 'QUALITY_CHECK'].includes(job.status)) throw new ApiError(409, 'Receive the device before assigning a technician.');
  const tech = await prisma.technician.findFirst({
    where: { id: technicianId, verificationStatus: 'VERIFIED', technicianType: 'COMPANY', user: { status: 'ACTIVE' }, specialisations: { some: { serviceId: job.booking.serviceId } } },
    select: { id: true, userId: true, user: { select: { fullName: true } } },
  });
  if (!tech) throw new ApiError(422, 'Validation failed', [{ field: 'technicianId', message: 'That technician cannot work on this job' }]);
  await prisma.$transaction(async (tx) => {
    await tx.jobAssignment.updateMany({ where: { jobId: job.id, status: { in: ACTIVE_ASSIGNMENT } }, data: { status: 'WITHDRAWN' } });
    await tx.jobAssignment.create({ data: { jobId: job.id, technicianId: tech.id, assignedById: req.user.id, status: 'ACCEPTED', acceptedAt: new Date() } });
    await tx.jobStatusHistory.create({ data: { jobId: job.id, previousStatus: job.status, newStatus: job.status, changedById: req.user.id, notes: `Workshop technician: ${tech.user.fullName}` } });
    await notify(tx, tech.userId, 'Workshop job assigned', `${job.booking.reference}: ${deviceText(job.booking.device)} at ${job.workshop.name}. Open My jobs to start.`, 'JOB_ASSIGNED');
    await notify(tx, job.booking.customer.userId, 'A technician is working on your device', `${tech.user.fullName} will diagnose and repair your device at ${job.workshop.name}.`, 'TECHNICIAN_ASSIGNED');
    await audit(tx, { userId: req.user.id, action: 'WORKSHOP_TECHNICIAN_ASSIGNED', entityType: 'Job', entityId: job.id, newValues: { technicianId: tech.id }, ip: req.ip });
  });
  ok(res, { technician: tech.user.fullName }, 'Technician assigned');
}));

router.post('/workshop/jobs/:id/activity', ...crew, asyncHandler(async (req, res) => {
  const body = z.object({ activityType: z.enum(['ACTIVITY', 'PART_REQUEST', 'TEST_RESULT', 'NOTE']), notes: z.string().trim().min(3, 'Write what was done').max(1000) }).parse(req.body);
  const job = await loadJob(req, req.params.id);
  if (job.status === 'WORKSHOP_TRANSFER') throw new ApiError(409, 'Receive the device first.');
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.repairActivity.create({ data: { jobId: job.id, recordedById: req.user.id, recordedBy: await nameOf(req.user.id), ...body } });
    if (body.activityType === 'PART_REQUEST') await notifyOps(tx, 'Spare part requested', `${job.booking.reference} at ${job.workshop.name}: ${body.notes}`, 'PART_REQUESTED');
    return created;
  });
  ok(res, entry, 'Recorded', 201);
}));

router.post('/workshop/jobs/:id/start-repair', ...crew, asyncHandler(async (req, res) => {
  const job = await loadJob(req, req.params.id);
  if (job.status !== 'APPROVED') throw new ApiError(409, 'The customer must approve the quotation before repair starts.');
  await prisma.$transaction(async (tx) => {
    await moveJob(tx, { job, to: 'WORKSHOP_REPAIR', userId: req.user.id, notes: 'Workshop repair started' });
    await notify(tx, job.booking.customer.userId, 'Repair has started', `Work on ${job.booking.reference} has begun at ${job.workshop.name}.`, 'REPAIR_STARTED');
  });
  ok(res, { status: 'WORKSHOP_REPAIR' }, 'Repair started');
}));

router.post('/workshop/jobs/:id/request-quality-check', ...crew, asyncHandler(async (req, res) => {
  const job = await loadJob(req, req.params.id);
  if (job.status !== 'WORKSHOP_REPAIR') throw new ApiError(409, 'Only a job under repair can be sent to quality inspection.');
  await prisma.$transaction(async (tx) => {
    await moveJob(tx, { job, to: 'QUALITY_CHECK', userId: req.user.id, notes: 'Quality inspection requested' });
    await notify(tx, job.booking.customer.userId, 'Repair completed', `The repair on ${job.booking.reference} is done and is going through final checks.`, 'REPAIR_COMPLETED');
  });
  ok(res, { status: 'QUALITY_CHECK' }, 'Sent to quality inspection');
}));

// ───────── 8.5 Quality control ─────────
const qcSchema = z.object({
  testsPerformed: z.string().trim().min(3, 'List the tests performed').max(1000),
  testResults: z.string().trim().min(3, 'Record the results').max(1000),
  outstandingIssues: z.string().trim().max(1000).optional(),
  passed: z.boolean(),
  waive: z.boolean().optional(),
  waiverReason: z.string().trim().min(5, 'Give the reason for waiving').max(500).optional(),
});

router.post('/workshop/jobs/:id/quality-check', ...crew, asyncHandler(async (req, res) => {
  const body = qcSchema.parse(req.body);
  const job = await loadJob(req, req.params.id);
  if (job.status !== 'QUALITY_CHECK') throw new ApiError(409, 'This job is not at quality inspection.');
  if (body.waive && !isOps(req.user)) throw new ApiError(403, 'Only Operations can formally waive a quality check.');
  if (body.waive && !body.waiverReason) throw new ApiError(422, 'Validation failed', [{ field: 'waiverReason', message: 'Give the reason for waiving' }]);
  const approve = body.passed || body.waive;
  if (approve && !(await prisma.serviceReport.findFirst({ where: { jobId: job.id }, select: { id: true } }))) {
    throw new ApiError(409, 'The technician must submit the service report before the device can be approved.');
  }
  const inspector = await nameOf(req.user.id);
  await prisma.$transaction(async (tx) => {
    await tx.qualityCheck.create({
      data: { jobId: job.id, inspectorId: req.user.id, inspectorName: inspector, testsPerformed: body.testsPerformed, testResults: body.testResults, outstandingIssues: body.outstandingIssues, passed: body.passed, waived: !!body.waive, waiverReason: body.waive ? body.waiverReason : null },
    });
    if (approve) {
      await readyForHandover(tx, { job, userId: req.user.id, notes: body.waive ? `Quality check waived: ${body.waiverReason}` : 'Quality check passed' });
    } else {
      // A failed inspection returns the device to repair (8.5).
      await moveJob(tx, { job, to: 'WORKSHOP_REPAIR', userId: req.user.id, notes: `Quality check failed: ${body.outstandingIssues || body.testResults}`.slice(0, 480) });
      const tech = await tx.jobAssignment.findFirst({ where: { jobId: job.id, status: 'ACCEPTED' }, select: { technician: { select: { userId: true } } } });
      if (tech) await notify(tx, tech.technician.userId, 'Quality check failed', `${job.booking.reference} returned to repair: ${body.outstandingIssues || body.testResults}`.slice(0, 240), 'QUALITY_FAILED');
    }
    await audit(tx, { userId: req.user.id, action: approve ? 'QUALITY_APPROVED' : 'QUALITY_FAILED', entityType: 'Job', entityId: job.id, newValues: { waived: !!body.waive }, ip: req.ip });
  });
  ok(res, { status: approve ? 'READY_FOR_HANDOVER' : 'WORKSHOP_REPAIR' }, approve ? 'Approved and ready for release' : 'Returned to repair');
}));

// ───────── 8.6 Release ─────────
const releaseSchema = z.object({
  conditionAtRelease: z.string().trim().min(3, 'Record the condition').max(1000),
  accessoriesReleased: z.string().trim().min(2, 'List the accessories, or write None').max(500),
  collectedBy: z.string().trim().min(2).max(120).optional(),
  waivePayment: z.boolean().optional(),
  waiverReason: z.string().trim().min(5).max(500).optional(),
});

router.post('/workshop/jobs/:id/release', ...crew, asyncHandler(async (req, res) => {
  const body = releaseSchema.parse(req.body);
  const job = await loadJob(req, req.params.id);
  if (job.status !== 'READY_FOR_HANDOVER') throw new ApiError(409, 'This device is not ready for release.');
  const method = job.booking.fulfilmentMethod;
  if (method === 'WORKSHOP' && !body.collectedBy) throw new ApiError(422, 'Validation failed', [{ field: 'collectedBy', message: 'Enter the name of the person collecting the device' }]);

  const [qc, invoice] = await Promise.all([
    prisma.qualityCheck.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: 'desc' } }),
    prisma.invoice.findFirst({ where: { jobId: job.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' } }),
  ]);
  if (!qc || !(qc.passed || qc.waived)) throw new ApiError(409, 'The device must pass quality inspection before release.');
  const unpaid = invoice && Number(invoice.balance) > 0;
  if (unpaid) {
    if (!body.waivePayment) throw new ApiError(409, `Payment is outstanding (UGX ${Number(invoice.balance).toLocaleString('en-UG')}). Record the payment before release.`);
    if (!isOps(req.user) || !body.waiverReason) throw new ApiError(403, 'Only Operations can release an unpaid device, and must give a reason.');
  }
  const releaser = await nameOf(req.user.id);
  await prisma.$transaction(async (tx) => {
    if (method === 'WORKSHOP') {
      await recordMovement(tx, {
        jobId: job.id, type: 'CUSTOMER_COLLECTION', from: job.workshop.name, to: 'Customer',
        releasingId: req.user.id, releasingName: releaser, receivingId: job.booking.customer.userId, receivingName: body.collectedBy,
        conditionBefore: body.conditionAtRelease, accessories: body.accessoriesReleased, acknowledgedBy: body.collectedBy,
      });
      await completeJob(tx, job, req.user.id, `Released to ${body.collectedBy}${unpaid ? ` (payment waived: ${body.waiverReason})` : ''}`);
      await notify(tx, job.booking.customer.userId, 'Repair complete', `You collected your device for ${job.booking.reference}. Thank you for choosing FixPro.`, 'JOB_COMPLETED');
    } else {
      // Collection and delivery: a delivery order is created for Operations to assign (9.4).
      const open = await tx.collectionDeliveryOrder.findFirst({ where: { jobId: job.id, orderType: 'DELIVERY', status: { in: ['CREATED', 'ASSIGNED', 'EN_ROUTE'] } } });
      if (!open) await createOrder(tx, { job, workshop: job.workshop, orderType: 'DELIVERY', condition: body.conditionAtRelease, accessories: body.accessoriesReleased });
      await notifyOps(tx, 'Delivery needed', `${job.booking.reference} is released from ${job.workshop.name}. Assign a delivery person.`, 'DELIVERY_NEEDED');
      await notify(tx, job.booking.customer.userId, 'Your device is on its way soon', `${job.booking.reference} is repaired and will be delivered to you. We will confirm the time.`, 'DELIVERY_PENDING');
    }
    await audit(tx, { userId: req.user.id, action: 'WORKSHOP_RELEASED', entityType: 'Job', entityId: job.id, newValues: { method, paymentWaived: !!unpaid }, ip: req.ip });
  });
  ok(res, { status: method === 'WORKSHOP' ? 'COMPLETED' : 'AWAITING_DELIVERY' }, method === 'WORKSHOP' ? 'Released to the customer' : 'Released. A delivery order was created.');
}));

// ───────── 8.3 Custody history and fulfilment details ─────────
async function allowedOnBooking(user, booking) {
  if (isStaff(user) || booking.customer.userId === user.id) return true;
  if (booking.jobs.some((j) => j.workshop?.managerUserId === user.id)) return true;
  if (booking.jobs.some((j) => j.assignments.some((a) => a.technician.userId === user.id))) return true;
  return booking.jobs.some((j) => j.logisticsOrders.some((o) => o.assignedPersonId === user.id));
}

router.get('/bookings/:id/fulfilment', authenticate, asyncHandler(async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    select: {
      fulfilmentMethod: true, customer: { select: { userId: true } },
      jobs: {
        orderBy: { createdAt: 'desc' }, take: 1,
        select: {
          id: true, workshop: true,
          assignments: { where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, select: { technician: { select: { userId: true } } } },
          logisticsOrders: { orderBy: { createdAt: 'asc' }, include: { attempts: { orderBy: { createdAt: 'asc' } } } },
        },
      },
    },
  });
  if (!booking || !(await allowedOnBooking(req.user, booking))) throw new ApiError(404, 'Booking not found');
  const job = booking.jobs[0];
  if (!job || booking.fulfilmentMethod === 'DOORSTEP') return ok(res, null);
  const people = await prisma.user.findMany({ where: { id: { in: job.logisticsOrders.map((o) => o.assignedPersonId).filter(Boolean) } }, select: { id: true, fullName: true, phone: true } });
  const person = Object.fromEntries(people.map((p) => [p.id, p]));
  const [custody, received] = await Promise.all([
    prisma.equipmentMovement.findMany({ where: { jobId: job.id }, orderBy: { createdAt: 'asc' }, select: { movementType: true, fromLocation: true, toLocation: true, releasingName: true, receivingName: true, conditionBefore: true, conditionAfter: true, accessories: true, acknowledgedBy: true, acknowledgedAt: true, createdAt: true } }),
    prisma.workshopInspection.findFirst({ where: { jobId: job.id }, select: { receivedCondition: true, accessoriesReceived: true, existingDamage: true, inspectedAt: true } }),
  ]);
  const workshop = job.workshop && { name: job.workshop.name, address: job.workshop.address, district: job.workshop.district, operatingHours: job.workshop.operatingHours, contactPhone: job.workshop.contactPhone, contactPerson: job.workshop.contactPerson };
  ok(res, {
    method: booking.fulfilmentMethod, workshop, received, custody,
    orders: job.logisticsOrders.map((o) => ({
      reference: o.reference, orderType: o.orderType, status: o.status, scheduledAt: o.scheduledAt, preferredTime: o.preferredTime, collectedAt: o.collectedAt, deliveredAt: o.deliveredAt,
      transportCharge: Number(o.transportCharge), instructions: o.instructions, pickupAddress: o.pickupAddress, destinationAddress: o.destinationAddress,
      person: o.assignedPersonId ? person[o.assignedPersonId] ?? null : null,
      attempts: o.attempts.map((a) => ({ reason: a.reason, explanation: a.explanation, followUp: a.followUp, rescheduledFor: a.rescheduledFor, createdAt: a.createdAt })),
    })),
  });
}));

export default router;
