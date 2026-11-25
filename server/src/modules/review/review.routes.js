import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { config, isServedDistrict } from '../../config.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { fulfilmentOptions, FULFILMENT } from '../../lib/fulfilment.js';
import { moveJob, notify } from '../../lib/workflow.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

// Mounted at /admin. Operations review of new bookings (requirements 6.1) and approval of public testimonials.
const router = Router();
router.use(authenticate, requireRole('OPERATIONS_ADMIN'));

const REVIEWABLE = ['NEW_REQUEST', 'UNDER_REVIEW'];

const loadBooking = async (id) => {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true, allowedFulfilment: true, category: { select: { name: true } } } },
      device: true,
      address: true,
      customer: { select: { userId: true, user: { select: { fullName: true, phone: true } } } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      attachments: { select: { id: true, fileType: true } },
    },
  });
  if (!b) throw new ApiError(404, 'Booking not found');
  if (!REVIEWABLE.includes(b.status) || !b.jobs[0]) throw new ApiError(409, 'This booking is no longer in review.');
  return b;
};

const checksFor = async (b) => {
  const covered = isServedDistrict(b.address.district);
  const options = await fulfilmentOptions(b.service.id, b.address.district);
  const chosen = options.find((o) => o.method === b.fulfilmentMethod);
  return { covered, district: b.address.district, fulfilment: { available: chosen.available, reason: chosen.reason, alternatives: chosen.alternatives.map((m) => FULFILMENT[m][0]) } };
};

router.get('/review/queue', asyncHandler(async (_req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { status: { in: REVIEWABLE }, jobs: { some: { status: 'CREATED' } } },
    orderBy: { createdAt: 'asc' }, take: 50,
    include: {
      service: { select: { id: true, name: true, allowedFulfilment: true, category: { select: { name: true } } } },
      device: true, address: true,
      customer: { select: { user: { select: { fullName: true, phone: true } } } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, reference: true } },
      attachments: { select: { id: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { authorRole: true, kind: true, message: true, createdAt: true } },
    },
  });
  const rows = [];
  for (const b of bookings) rows.push({ ...b, jobId: b.jobs[0].id, jobReference: b.jobs[0].reference, attachmentCount: b.attachments.length, lastMessage: b.messages[0] ?? null, checks: await checksFor(b) });
  ok(res, rows.map(({ jobs, attachments, messages, ...r }) => r));
}));

const history = (tx, job, newStatus, userId, notes) =>
  tx.jobStatusHistory.create({ data: { jobId: job.id, previousStatus: job.status, newStatus, changedById: userId, notes } });

router.post('/bookings/:id/start-review', asyncHandler(async (req, res) => {
  const b = await loadBooking(req.params.id);
  if (b.status !== 'NEW_REQUEST') throw new ApiError(409, 'This booking is already being reviewed.');
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { status: 'UNDER_REVIEW' } });
    await history(tx, b.jobs[0], 'UNDER_REVIEW', req.user.id, 'Operations started reviewing the request');
    await audit(tx, { userId: req.user.id, action: 'BOOKING_REVIEW_STARTED', entityType: 'Booking', entityId: b.id, ip: req.ip });
  });
  ok(res, { status: 'UNDER_REVIEW' }, 'Review started');
}));

router.post('/bookings/:id/request-clarification', asyncHandler(async (req, res) => {
  const { message } = z.object({ message: z.string().trim().min(5, 'Say what you need to know').max(1000) }).parse(req.body);
  const b = await loadBooking(req.params.id);
  await prisma.$transaction(async (tx) => {
    await tx.bookingMessage.create({ data: { bookingId: b.id, authorId: req.user.id, authorRole: 'STAFF', kind: 'CLARIFICATION_REQUEST', message } });
    if (b.status === 'NEW_REQUEST') {
      await tx.booking.update({ where: { id: b.id }, data: { status: 'UNDER_REVIEW' } });
      await history(tx, b.jobs[0], 'UNDER_REVIEW', req.user.id, 'Clarification requested from the customer');
    }
    await notify(tx, b.customer.userId, 'We need a little more information', `About booking ${b.reference}: ${message.slice(0, 160)}`, 'CLARIFICATION_REQUESTED');
    await audit(tx, { userId: req.user.id, action: 'BOOKING_CLARIFICATION_REQUESTED', entityType: 'Booking', entityId: b.id, ip: req.ip });
  });
  ok(res, null, 'Request sent to the customer');
}));

// Confirm or correct the service category.
router.patch('/bookings/:id/service', asyncHandler(async (req, res) => {
  const { serviceId } = z.object({ serviceId: z.string().uuid() }).parse(req.body);
  const b = await loadBooking(req.params.id);
  const service = await prisma.service.findFirst({ where: { id: serviceId, active: true }, select: { id: true, name: true } });
  if (!service) throw new ApiError(404, 'That service is not available');
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { serviceId } });
    await history(tx, b.jobs[0], b.status, req.user.id, `Service changed from ${b.service.name} to ${service.name}`);
    await notify(tx, b.customer.userId, 'Your service was updated', `We changed the service on ${b.reference} to ${service.name}.`, 'SERVICE_CHANGED');
    await audit(tx, { userId: req.user.id, action: 'BOOKING_SERVICE_CHANGED', entityType: 'Booking', entityId: b.id, previousValues: { serviceId: b.service.id }, newValues: { serviceId }, ip: req.ip });
  });
  ok(res, { serviceId }, 'Service updated');
}));

// Approve for assignment: coverage and fulfilment must both be possible.
router.post('/bookings/:id/approve', asyncHandler(async (req, res) => {
  const b = await loadBooking(req.params.id);
  const checks = await checksFor(b);
  if (!checks.covered) throw new ApiError(422, `${b.address.district} is not in our service area.`);
  if (!checks.fulfilment.available) throw new ApiError(422, `${checks.fulfilment.reason} Ask the customer to choose another option, or change the request.`);
  await prisma.$transaction(async (tx) => {
    await moveJob(tx, { job: b.jobs[0], to: 'AWAITING_ASSIGNMENT', userId: req.user.id, notes: 'Approved for assignment' });
    await notify(tx, b.customer.userId, 'Your booking was reviewed', `Booking ${b.reference} is approved. We are now finding you a technician.`, 'BOOKING_REVIEWED');
    await audit(tx, { userId: req.user.id, action: 'BOOKING_APPROVED', entityType: 'Booking', entityId: b.id, ip: req.ip });
  });
  ok(res, { status: 'AWAITING_ASSIGNMENT' }, 'Approved for assignment');
}));

router.post('/bookings/:id/decline', asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Give the customer a reason').max(500) }).parse(req.body);
  const b = await loadBooking(req.params.id);
  await prisma.$transaction(async (tx) => {
    await moveJob(tx, { job: b.jobs[0], to: 'CANCELLED', userId: req.user.id, notes: `Declined by operations: ${reason}` });
    await tx.booking.update({ where: { id: b.id }, data: { cancelReason: reason } });
    await notify(tx, b.customer.userId, 'We could not accept your booking', `Booking ${b.reference}: ${reason}`, 'BOOKING_DECLINED');
    await audit(tx, { userId: req.user.id, action: 'BOOKING_DECLINED', entityType: 'Booking', entityId: b.id, newValues: { reason }, ip: req.ip });
  });
  ok(res, { status: 'CANCELLED' }, 'Booking declined');
}));

// ── Testimonials: customers opt in, an administrator approves what appears publicly ──
router.get('/reviews', asyncHandler(async (req, res) => {
  const where = req.query.pending === 'true' ? { approved: false } : {};
  const rows = await prisma.review.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, rating: true, comment: true, allowPublic: true, approved: true, createdAt: true, customer: { select: { user: { select: { fullName: true } } } }, technician: { select: { user: { select: { fullName: true } } } }, job: { select: { reference: true, booking: { select: { service: { select: { name: true } } } } } } },
  });
  ok(res, rows);
}));

router.patch('/reviews/:id', asyncHandler(async (req, res) => {
  const { approved } = z.object({ approved: z.boolean() }).parse(req.body);
  const review = await prisma.review.update({ where: { id: req.params.id }, data: { approved }, select: { id: true, approved: true } });
  await audit(prisma, { userId: req.user.id, action: approved ? 'REVIEW_APPROVED' : 'REVIEW_HIDDEN', entityType: 'Review', entityId: review.id, ip: req.ip });
  ok(res, review, 'Review updated');
}));

export default router;
