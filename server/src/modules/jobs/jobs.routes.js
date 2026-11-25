import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { createInvoice } from '../../lib/billing.js';
import { PRIVATE_DIR, removeFiles, saveFile, uploadMedia } from '../../lib/uploads.js';
import { ACTIVE_ASSIGNMENT, FINAL_JOB, TECHNICIAN_TRANSITIONS, WORKSHOP_TRANSITIONS, moveJob, notify } from '../../lib/workflow.js';
import { authenticate, isStaff } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

const WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00'];
const STATUSES = ['APPOINTMENT_CONFIRMED', 'TECHNICIAN_EN_ROUTE', 'INSPECTION', 'IN_PROGRESS', 'WORKSHOP_REPAIR', 'QUALITY_CHECK', 'READY_FOR_HANDOVER', 'CANCELLED', 'DISPUTED'];

const statusSchema = z.object({
  status: z.enum(STATUSES),
  notes: z.string().trim().max(500).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').optional(),
  scheduledWindow: z.enum(WINDOWS).optional(),
});

// Resolves the technician record when this user holds an ACCEPTED assignment on the job.
export async function ownedAssignment(userId, jobId) {
  const technician = await prisma.technician.findUnique({ where: { userId } });
  if (!technician) return null;
  const assignment = await prisma.jobAssignment.findFirst({ where: { jobId, technicianId: technician.id, status: 'ACCEPTED' } });
  return assignment ? { technician, assignment } : null;
}

const customerOf = (tx, bookingId) =>
  tx.booking.findUnique({ where: { id: bookingId }, select: { reference: true, customerId: true, customer: { select: { userId: true } } } });

// POST /jobs/:id/status requests a controlled status change.
// Technicians follow the workflow map for jobs they have accepted; operations staff may cancel or dispute.
router.post('/:id/status', asyncHandler(async (req, res) => {
  const body = statusSchema.parse(req.body);
  const { status, notes } = body;
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) throw new ApiError(404, 'Job not found');
  if (FINAL_JOB.includes(job.status)) throw new ApiError(409, `This job is already ${job.status.toLowerCase()}.`);

  let owned = null;
  if (isStaff(req.user)) {
    if (!['CANCELLED', 'DISPUTED'].includes(status)) throw new ApiError(403, 'Only the assigned technician can progress this job.');
  } else {
    owned = await ownedAssignment(req.user.id, job.id);
    if (!owned) throw new ApiError(404, 'Job not found');
    if (!((job.assignedWorkshopId ? WORKSHOP_TRANSITIONS : TECHNICIAN_TRANSITIONS)[job.status] || []).includes(status)) throw new ApiError(409, `A job cannot move from ${job.status} to ${status}.`);
  }

  let scheduledFor;
  if (status === 'APPOINTMENT_CONFIRMED') {
    if (!body.scheduledDate || !body.scheduledWindow) {
      throw new ApiError(422, 'Validation failed', [{ field: 'scheduledDate', message: 'Choose the date and time window you will visit' }]);
    }
    scheduledFor = new Date(`${body.scheduledDate}T${body.scheduledWindow.slice(0, 5)}:00+03:00`); // Africa/Kampala
    if (scheduledFor.getTime() < Date.now() - 3_600_000) throw new ApiError(422, 'Validation failed', [{ field: 'scheduledDate', message: 'Choose a time that has not passed' }]);
    // Conflicting assignments are prevented (requirements 5.5).
    const clash = await prisma.job.findFirst({ where: { id: { not: job.id }, scheduledFor, scheduledWindow: body.scheduledWindow, status: { notIn: ['COMPLETED', 'CANCELLED'] }, assignments: { some: { technicianId: owned.technician.id, status: 'ACCEPTED' } } }, select: { reference: true } });
    if (clash) throw new ApiError(409, `You already have a job in that time window (${clash.reference || 'another job'}). Choose another time.`);
  }
  if (status === 'READY_FOR_HANDOVER') {
    const [report, approved] = await Promise.all([
      prisma.serviceReport.findFirst({ where: { jobId: job.id }, select: { id: true } }),
      prisma.quotation.findFirst({ where: { jobId: job.id, status: 'APPROVED' }, select: { id: true } }),
    ]);
    if (!report) throw new ApiError(409, 'Submit the service report before marking the repair ready for handover.');
    if (!approved) throw new ApiError(409, 'There is no approved quotation for this job.');
  }

  await prisma.$transaction(async (tx) => {
    await moveJob(tx, { job, to: status, userId: req.user.id, notes });
    const booking = await customerOf(tx, job.bookingId);
    const tell = (title, text, type) => notify(tx, booking.customer.userId, title, text, type);

    if (status === 'APPOINTMENT_CONFIRMED') {
      await tx.job.update({ where: { id: job.id }, data: { scheduledFor, scheduledWindow: body.scheduledWindow } });
      await tell('Appointment confirmed', `Your technician will come on ${body.scheduledDate}, between ${body.scheduledWindow.replace('-', ' and ')}.`, 'APPOINTMENT_CONFIRMED');
    }
    if (status === 'TECHNICIAN_EN_ROUTE') await tell('Technician on the way', `Your technician is on the way for booking ${booking.reference}.`, 'TECHNICIAN_EN_ROUTE');
    if (status === 'IN_PROGRESS') await tell('Repair has started', `Work on booking ${booking.reference} has begun.`, 'REPAIR_STARTED');
    if (status === 'QUALITY_CHECK') await tell('Repair completed', `The repair on ${booking.reference} is done and is going through final checks.`, 'REPAIR_COMPLETED');
    if (status === 'READY_FOR_HANDOVER') {
      // The invoice follows the latest approved quotation, including any approved revision.
      const approved = await tx.quotation.findFirst({ where: { jobId: job.id, status: 'APPROVED' }, orderBy: { version: 'desc' }, include: { items: true } });
      const invoice = await createInvoice(tx, {
        jobId: job.id, customerId: booking.customerId, quotationId: approved.id, tax: Number(approved.tax),
        lines: approved.items.map((i) => ({ description: i.description, itemType: i.itemType, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice })),
      });
      await tell('Your repair is ready', `Your device is ready for handover. Invoice ${invoice.reference} is UGX ${Number(invoice.total).toLocaleString('en-UG')}.`, 'READY_FOR_HANDOVER');
    }
    if (status === 'CANCELLED') await tx.jobAssignment.updateMany({ where: { jobId: job.id, status: { in: ACTIVE_ASSIGNMENT } }, data: { status: 'WITHDRAWN' } });
    await audit(tx, { userId: req.user.id, action: 'JOB_STATUS_CHANGED', entityType: 'Job', entityId: job.id, previousValues: { status: job.status }, newValues: { status }, ip: req.ip });
  });
  ok(res, { jobId: job.id, status }, 'Status updated');
}));

// ── Inspection (requirements 5.6) ──
const inspectionSchema = z.object({
  reportedSymptoms: z.string().trim().min(5, 'Describe what the customer reported').max(1000),
  findings: z.string().trim().min(10, 'Describe what you found').max(2000),
  diagnosis: z.string().trim().min(5, 'Give your diagnosis').max(1000),
  recommendedAction: z.string().trim().min(5, 'Say what repair you recommend').max(1000),
  partsRequired: z.string().trim().max(1000).optional(),
  estimatedWork: z.string().trim().max(500).optional(),
});

router.post('/:id/inspection', asyncHandler(async (req, res) => {
  const body = inspectionSchema.parse(req.body);
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  const owned = job && (await ownedAssignment(req.user.id, job.id));
  if (!owned) throw new ApiError(404, 'Job not found');
  if (job.status !== 'INSPECTION') throw new ApiError(409, 'Start the inspection before submitting a report.');
  const inspection = await prisma.$transaction(async (tx) => {
    const created = await tx.inspection.create({ data: { ...body, jobId: job.id, technicianId: owned.technician.id } });
    const booking = await customerOf(tx, job.bookingId);
    await notify(tx, booking.customer.userId, 'Inspection completed', `Your technician finished inspecting the device for ${booking.reference}. A quotation will follow.`, 'INSPECTION_COMPLETED');
    await audit(tx, { userId: req.user.id, action: 'INSPECTION_SUBMITTED', entityType: 'Job', entityId: job.id, ip: req.ip });
    return created;
  });
  ok(res, inspection, 'Inspection saved', 201);
}));

router.get('/:id/inspection', asyncHandler(async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { booking: { select: { customer: { select: { userId: true } } } } } });
  if (!job) throw new ApiError(404, 'Job not found');
  const allowed = isStaff(req.user) || job.booking.customer.userId === req.user.id || (await ownedAssignment(req.user.id, job.id));
  if (!allowed) throw new ApiError(404, 'Job not found');
  const inspection = await prisma.inspection.findFirst({ where: { jobId: job.id }, orderBy: { createdAt: 'desc' } });
  if (!inspection) throw new ApiError(404, 'No inspection has been submitted yet');
  ok(res, inspection);
}));

// ── Repair photographs ──
router.post('/:id/photos', uploadMedia.array('photos', 4), asyncHandler(async (req, res) => {
  const kind = z.enum(['INSPECTION', 'REPAIR', 'COMPLETION']).parse(req.body?.kind ?? 'REPAIR');
  const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { _count: { select: { photos: true } } } });
  const owned = job && (await ownedAssignment(req.user.id, job.id));
  if (!owned) throw new ApiError(404, 'Job not found');
  const files = req.files || [];
  if (!files.length) throw new ApiError(422, 'Validation failed', [{ field: 'photos', message: 'Choose at least one photo' }]);
  if (job._count.photos + files.length > 16) throw new ApiError(422, 'Validation failed', [{ field: 'photos', message: 'A job can have up to 16 photos' }]);
  const dir = path.join(PRIVATE_DIR, 'jobs');
  const saved = [];
  try {
    for (const f of files) saved.push((await saveFile(f, dir, { allow: ['IMAGE'], field: 'photos', label: 'Each photo' })).name);
    const rows = await prisma.$transaction(saved.map((fileName) => prisma.jobPhoto.create({ data: { jobId: job.id, kind, fileName, uploadedById: req.user.id }, select: { id: true, kind: true } })));
    ok(res, rows, 'Photos added', 201);
  } catch (err) { await removeFiles(saved.map((n) => path.join(dir, n))); throw err; }
}));

// ── Service report ──
const reportSchema = z.object({
  workPerformed: z.string().trim().min(10, 'Describe the work you did').max(2000),
  partsReplaced: z.string().trim().max(1000).optional(),
  testResults: z.string().trim().min(3, 'Say how you tested the repair').max(1000),
  completionRemarks: z.string().trim().max(1000).optional(),
  recommendations: z.string().trim().max(1000).optional(),
});

router.post('/:id/service-report', asyncHandler(async (req, res) => {
  const body = reportSchema.parse(req.body);
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  const owned = job && (await ownedAssignment(req.user.id, job.id));
  if (!owned) throw new ApiError(404, 'Job not found');
  if (!['IN_PROGRESS', 'WORKSHOP_REPAIR', 'QUALITY_CHECK'].includes(job.status)) throw new ApiError(409, 'A service report can be submitted once the repair is under way.');
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.serviceReport.create({ data: { ...body, jobId: job.id, technicianId: owned.technician.id } });
    await audit(tx, { userId: req.user.id, action: 'SERVICE_REPORT_SUBMITTED', entityType: 'Job', entityId: job.id, ip: req.ip });
    return created;
  });
  ok(res, report, 'Service report saved', 201);
}));

// ── Customer rating after completion. It also feeds technician matching and, with permission, public testimonials. ──
router.post('/:id/review', asyncHandler(async (req, res) => {
  const body = z.object({ rating: z.number().int().min(1, 'Choose a rating').max(5), comment: z.string().trim().max(500).optional(), allowPublic: z.boolean().optional() }).parse(req.body);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { booking: { select: { customer: { select: { id: true, userId: true } } } }, assignments: { where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, take: 1, select: { technicianId: true } } },
  });
  if (!job || job.booking.customer.userId !== req.user.id) throw new ApiError(404, 'Job not found');
  if (job.status !== 'COMPLETED' || !job.assignments[0]) throw new ApiError(409, 'You can rate a repair once it is completed.');
  try {
    await prisma.review.create({ data: { jobId: job.id, customerId: job.booking.customer.id, technicianId: job.assignments[0].technicianId, rating: body.rating, comment: body.comment, allowPublic: !!body.allowPublic && !!body.comment } });
  } catch (err) {
    if (err?.code === 'P2002') throw new ApiError(409, 'You have already rated this repair.');
    throw err;
  }
  ok(res, null, 'Thank you for your feedback', 201);
}));

export default router;
