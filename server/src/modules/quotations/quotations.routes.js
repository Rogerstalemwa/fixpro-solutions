import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { createInvoice, newRef, priceQuotation } from '../../lib/billing.js';
import { ACTIVE_ASSIGNMENT, moveJob, notify } from '../../lib/workflow.js';
import { authenticate, isStaff, requireRole } from '../../middleware/auth.js';
import { ownedAssignment } from '../jobs/jobs.routes.js';

const router = Router();
router.use(authenticate);

const itemSchema = z.object({
  description: z.string().trim().min(2, 'Describe the item').max(200),
  itemType: z.enum(['PART', 'LABOUR']),
  quantity: z.coerce.number().positive('Quantity must be more than 0').max(1000),
  unitPrice: z.coerce.number().nonnegative('Price cannot be negative').max(50_000_000),
});
const quotationSchema = z.object({ items: z.array(itemSchema).min(1, 'Add at least one item').max(30) });

const QUOTE_VALID_DAYS = 7;

// Technician issues (or revises) a quotation. Totals and the diagnostic fee are calculated here.
router.post('/jobs/:id/quotation', asyncHandler(async (req, res) => {
  const { items } = quotationSchema.parse(req.body);
  const job = await prisma.job.findUnique({ where: { id: req.params.id }, include: { booking: { select: { service: { select: { diagnosticFee: true } }, customer: { select: { userId: true } }, reference: true } } } });
  const owned = job && (await ownedAssignment(req.user.id, job.id));
  if (!owned) throw new ApiError(404, 'Job not found');
  if (!['INSPECTION', 'AWAITING_APPROVAL'].includes(job.status)) throw new ApiError(409, 'A quotation can be issued during inspection, before the customer approves.');
  if (!(await prisma.inspection.findFirst({ where: { jobId: job.id }, select: { id: true } }))) throw new ApiError(409, 'Submit the inspection report before issuing a quotation.');

  const priced = priceQuotation(items, job.booking.service.diagnosticFee);
  const quotation = await prisma.$transaction(async (tx) => {
    const last = await tx.quotation.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' }, select: { version: true } });
    await tx.quotation.updateMany({ where: { jobId: job.id, status: { in: ['DRAFT', 'SENT', 'REVISION_REQUESTED'] } }, data: { status: 'SUPERSEDED' } });
    const created = await tx.quotation.create({
      data: {
        reference: newRef('QUO'), jobId: job.id, version: (last?.version ?? 0) + 1,
        subtotal: priced.subtotal, discount: priced.discount, tax: priced.tax, total: priced.total,
        status: 'SENT', preparedById: req.user.id, expiresAt: new Date(Date.now() + QUOTE_VALID_DAYS * 86_400_000),
        items: { create: priced.lines },
      },
      include: { items: true },
    });
    if (job.status === 'INSPECTION') await moveJob(tx, { job, to: 'AWAITING_APPROVAL', userId: req.user.id, notes: `Quotation ${created.reference} sent` });
    await notify(tx, job.booking.customer.userId, 'Your quotation is ready', `Quotation ${created.reference} for booking ${job.booking.reference} is UGX ${priced.total.toLocaleString('en-UG')}. Review and approve it to start the repair.`, 'QUOTATION_SENT');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_SENT', entityType: 'Quotation', entityId: created.id, newValues: { total: priced.total }, ip: req.ip });
    return created;
  });
  ok(res, quotation, 'Quotation sent to the customer', 201);
}));

// Who may see a quotation: staff, the owning customer, or the assigned technician.
async function loadQuotation(req, id) {
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: { items: true, job: { include: { booking: { select: { id: true, reference: true, customerId: true, service: { select: { diagnosticFee: true } }, customer: { select: { userId: true } } } } } } },
  });
  if (!quotation) throw new ApiError(404, 'Quotation not found');
  const isOwner = quotation.job.booking.customer.userId === req.user.id;
  const allowed = isStaff(req.user) || isOwner || (await prisma.jobAssignment.findFirst({ where: { jobId: quotation.jobId, technician: { userId: req.user.id } }, select: { id: true } }));
  if (!allowed) throw new ApiError(404, 'Quotation not found');
  return { quotation, isOwner };
}

router.get('/quotations/:id', asyncHandler(async (req, res) => {
  const { quotation } = await loadQuotation(req, req.params.id);
  const { job, ...rest } = quotation;
  ok(res, rest);
}));

// ── Customer decisions ──
async function decide(req, res, handler) {
  const { quotation, isOwner } = await loadQuotation(req, req.params.id);
  if (!isOwner) throw new ApiError(403, 'Only the customer who requested this repair can respond to the quotation.');
  if (quotation.status !== 'SENT') throw new ApiError(409, 'This quotation can no longer be answered.');
  if (quotation.job.status !== 'AWAITING_APPROVAL') throw new ApiError(409, 'This job is not waiting for approval.');
  if (quotation.expiresAt && quotation.expiresAt < new Date()) {
    await prisma.quotation.update({ where: { id: quotation.id }, data: { status: 'EXPIRED' } });
    throw new ApiError(409, 'This quotation has expired. Ask your technician to send a new one.');
  }
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.quotation.updateMany({ where: { id: quotation.id, status: 'SENT' }, data: {} });
    if (!claimed.count) throw new ApiError(409, 'This quotation can no longer be answered.');
    await handler(tx, quotation);
  });
}

const technicianUserOf = async (tx, jobId) => (await tx.jobAssignment.findFirst({ where: { jobId, status: 'ACCEPTED' }, select: { technician: { select: { userId: true } } } }))?.technician.userId;

router.post('/quotations/:id/approve', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  await decide(req, res, async (tx, q) => {
    await tx.quotation.update({ where: { id: q.id }, data: { status: 'APPROVED', approvedById: req.user.id, approvedAt: new Date() } });
    await moveJob(tx, { job: q.job, to: 'APPROVED', userId: req.user.id, notes: `Customer approved quotation ${q.reference}` });
    const techUser = await technicianUserOf(tx, q.jobId);
    if (techUser) await notify(tx, techUser, 'Quotation approved', `The customer approved quotation ${q.reference}. You can start the repair.`, 'QUOTATION_APPROVED');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_APPROVED', entityType: 'Quotation', entityId: q.id, newValues: { total: q.total }, ip: req.ip });
  });
  ok(res, { id: req.params.id, status: 'APPROVED' }, 'Quotation approved');
}));

// Declining ends the job. Only the diagnostic fee is invoiced.
router.post('/quotations/:id/reject', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  await decide(req, res, async (tx, q) => {
    await tx.quotation.update({ where: { id: q.id }, data: { status: 'REJECTED', revisionNote: reason } });
    const techUser = await technicianUserOf(tx, q.jobId);
    await tx.jobAssignment.updateMany({ where: { jobId: q.jobId, status: { in: ACTIVE_ASSIGNMENT } }, data: { status: 'COMPLETED' } });
    await moveJob(tx, { job: q.job, to: 'CANCELLED', userId: req.user.id, notes: `Quotation ${q.reference} declined${reason ? `: ${reason}` : ''}` });
    const fee = Number(q.job.booking.service.diagnosticFee || 0);
    if (fee > 0) {
      await createInvoice(tx, { jobId: q.jobId, customerId: q.job.booking.customerId, quotationId: q.id, lines: [{ description: 'Diagnostic fee', quantity: 1, unitPrice: fee, totalPrice: fee }] });
    }
    if (techUser) await notify(tx, techUser, 'Quotation declined', `The customer declined quotation ${q.reference}. The job is closed.`, 'QUOTATION_REJECTED');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_REJECTED', entityType: 'Quotation', entityId: q.id, ip: req.ip });
  });
  ok(res, { id: req.params.id, status: 'REJECTED' }, 'Quotation declined');
}));

router.post('/quotations/:id/request-revision', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(3, 'Tell the technician what to change').max(500) }).parse(req.body);
  await decide(req, res, async (tx, q) => {
    await tx.quotation.update({ where: { id: q.id }, data: { status: 'REVISION_REQUESTED', revisionNote: note } });
    await moveJob(tx, { job: q.job, to: 'INSPECTION', userId: req.user.id, notes: `Revision requested: ${note}` });
    const techUser = await technicianUserOf(tx, q.jobId);
    if (techUser) await notify(tx, techUser, 'Revision requested', `The customer asked for changes to quotation ${q.reference}: ${note}`, 'QUOTATION_REVISION');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_REVISION_REQUESTED', entityType: 'Quotation', entityId: q.id, newValues: { note }, ip: req.ip });
  });
  ok(res, { id: req.params.id, status: 'REVISION_REQUESTED' }, 'Revision requested');
}));

export default router;
