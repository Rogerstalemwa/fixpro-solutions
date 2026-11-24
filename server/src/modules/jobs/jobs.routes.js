import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { createInvoice } from '../../lib/billing.js';
import { ACTIVE_ASSIGNMENT, FINAL_JOB, TECHNICIAN_TRANSITIONS, moveJob, notify } from '../../lib/workflow.js';
import { authenticate, isStaff } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

const WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00'];
const STATUSES = [
  'APPOINTMENT_CONFIRMED', 'TECHNICIAN_EN_ROUTE', 'INSPECTION', 'IN_PROGRESS', 'QUALITY_CHECK', 'READY_FOR_HANDOVER', 'CANCELLED', 'DISPUTED',
];

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

  if (isStaff(req.user)) {
    if (!['CANCELLED', 'DISPUTED'].includes(status)) throw new ApiError(403, 'Only the assigned technician can progress this job.');
  } else {
    if (!(await ownedAssignment(req.user.id, job.id))) throw new ApiError(404, 'Job not found');
    if (!(TECHNICIAN_TRANSITIONS[job.status] || []).includes(status)) throw new ApiError(409, `A job cannot move from ${job.status} to ${status}.`);
  }

  let scheduledFor;
  if (status === 'APPOINTMENT_CONFIRMED') {
    if (!body.scheduledDate || !body.scheduledWindow) {
      throw new ApiError(422, 'Validation failed', [{ field: 'scheduledDate', message: 'Choose the date and time window you will visit' }]);
    }
    scheduledFor = new Date(`${body.scheduledDate}T${body.scheduledWindow.slice(0, 5)}:00+03:00`); // Africa/Kampala
    if (scheduledFor.getTime() < Date.now() - 3_600_000) throw new ApiError(422, 'Validation failed', [{ field: 'scheduledDate', message: 'Choose a time that has not passed' }]);
  }
  if (status === 'READY_FOR_HANDOVER') {
    const [report, approved] = await Promise.all([
      prisma.serviceReport.findFirst({ where: { jobId: job.id }, select: { id: true } }),
      prisma.quotation.findFirst({ where: { jobId: job.id, status: 'APPROVED' }, include: { items: true } }),
    ]);
    if (!report) throw new ApiError(409, 'Submit the service report before marking the repair ready for handover.');
    if (!approved) throw new ApiError(409, 'There is no approved quotation for this job.');
  }

  await prisma.$transaction(async (tx) => {
    await moveJob(tx, { job, to: status, userId: req.user.id, notes });
    const booking = await customerOf(tx, job.bookingId);

    if (status === 'APPOINTMENT_CONFIRMED') {
      await tx.job.update({ where: { id: job.id }, data: { scheduledFor, scheduledWindow: body.scheduledWindow } });
      await notify(tx, booking.customer.userId, 'Appointment confirmed', `Your technician will come on ${body.scheduledDate}, between ${body.scheduledWindow.replace('-', ' and ')}.`, 'APPOINTMENT_CONFIRMED');
    }
    if (status === 'TECHNICIAN_EN_ROUTE') {
      await notify(tx, booking.customer.userId, 'Technician on the way', `Your technician is on the way for booking ${booking.reference}.`, 'TECHNICIAN_EN_ROUTE');
    }
    if (status === 'READY_FOR_HANDOVER') {
      const approved = await tx.quotation.findFirst({ where: { jobId: job.id, status: 'APPROVED' }, include: { items: true } });
      const invoice = await createInvoice(tx, {
        jobId: job.id, customerId: booking.customerId, quotationId: approved.id,
        lines: approved.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice })),
      });
      await notify(tx, booking.customer.userId, 'Your repair is ready', `Your device is ready for handover. Invoice ${invoice.reference} is UGX ${Number(invoice.total).toLocaleString('en-UG')}.`, 'READY_FOR_HANDOVER');
    }
    if (status === 'CANCELLED') {
      await tx.jobAssignment.updateMany({ where: { jobId: job.id, status: { in: ACTIVE_ASSIGNMENT } }, data: { status: 'WITHDRAWN' } });
    }
    await audit(tx, { userId: req.user.id, action: 'JOB_STATUS_CHANGED', entityType: 'Job', entityId: job.id, previousValues: { status: job.status }, newValues: { status }, ip: req.ip });
  });
  ok(res, { jobId: job.id, status }, 'Status updated');
}));

// ── Inspection ──
const inspectionSchema = z.object({
  reportedSymptoms: z.string().trim().min(5, 'Describe what the customer reported').max(1000),
  findings: z.string().trim().min(10, 'Describe what you found').max(2000),
  recommendedAction: z.string().trim().min(5, 'Say what you recommend').max(1000),
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

// ── Service report ──
const reportSchema = z.object({
  workPerformed: z.string().trim().min(10, 'Describe the work you did').max(2000),
  partsReplaced: z.string().trim().max(1000).optional(),
  testResults: z.string().trim().min(3, 'Say how you tested the repair').max(1000),
  recommendations: z.string().trim().max(1000).optional(),
});

router.post('/:id/service-report', asyncHandler(async (req, res) => {
  const body = reportSchema.parse(req.body);
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  const owned = job && (await ownedAssignment(req.user.id, job.id));
  if (!owned) throw new ApiError(404, 'Job not found');
  if (!['IN_PROGRESS', 'QUALITY_CHECK'].includes(job.status)) throw new ApiError(409, 'A service report can be submitted once the repair is under way.');
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.serviceReport.create({ data: { ...body, jobId: job.id, technicianId: owned.technician.id } });
    await audit(tx, { userId: req.user.id, action: 'SERVICE_REPORT_SUBMITTED', entityType: 'Job', entityId: job.id, ip: req.ip });
    return created;
  });
  ok(res, report, 'Service report saved', 201);
}));

export default router;
