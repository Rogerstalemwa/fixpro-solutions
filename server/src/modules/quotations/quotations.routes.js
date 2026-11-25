import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { createInvoice, newRef, priceQuotation } from '../../lib/billing.js';
import { ACTIVE_ASSIGNMENT, moveJob, notify } from '../../lib/workflow.js';
import { authenticate, isStaff, requireRole } from '../../middleware/auth.js';
import { ownedAssignment } from '../jobs/jobs.routes.js';

const router = Router();
router.use(authenticate);

// Quotation lines (requirements 7.1). The diagnostic charge is added by the system from the service catalogue.
const itemSchema = z.object({
  description: z.string().trim().min(2, 'Describe the item').max(200),
  itemType: z.enum(['PART', 'LABOUR', 'TRANSPORT', 'WORKSHOP', 'OTHER']),
  quantity: z.coerce.number().positive('Quantity must be more than 0').max(1000),
  unitPrice: z.coerce.number().nonnegative('Price cannot be negative').max(50_000_000),
});
const quotationSchema = z.object({
  items: z.array(itemSchema).min(1, 'Add at least one item').max(30),
  revisionReason: z.string().trim().min(10, 'Explain the additional work (at least 10 characters)').max(500).optional(),
});

const QUOTE_VALID_DAYS = 7;

// A technician issues a quotation, or a revision when more faults are found.
// A revision keeps the original, explains the extra work, shows the new total and needs the customer's approval again (7.4).
router.post('/jobs/:id/quotation', asyncHandler(async (req, res) => {
  const { items, revisionReason } = quotationSchema.parse(req.body);
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      booking: { select: { reference: true, service: { select: { diagnosticFee: true } }, customer: { select: { userId: true } } } },
      inspections: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const owned = job && (await ownedAssignment(req.user.id, job.id));
  if (!owned) throw new ApiError(404, 'Job not found');
  if (!['INSPECTION', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS'].includes(job.status)) throw new ApiError(409, 'A quotation can be issued during inspection, or revised while the repair is under way.');
  const inspection = job.inspections[0];
  if (!inspection) throw new ApiError(409, 'Submit the inspection report before issuing a quotation.');

  const priced = priceQuotation(items, job.booking.service.diagnosticFee, config.vatRate);
  const quotation = await prisma.$transaction(async (tx) => {
    const open = await tx.quotation.findFirst({ where: { jobId: job.id, status: { in: ['SENT', 'REVISION_REQUESTED'] } }, orderBy: { version: 'desc' } });
    const resumeStatus = open ? open.resumeStatus : ['APPROVED', 'IN_PROGRESS'].includes(job.status) ? job.status : null;
    const reason = revisionReason ?? open?.revisionReason ?? null;
    if (resumeStatus && !reason) throw new ApiError(422, 'Validation failed', [{ field: 'revisionReason', message: 'Explain the additional work' }]);
    const last = await tx.quotation.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' }, select: { version: true } });
    // Earlier unanswered versions are replaced. An approved quotation is always kept.
    await tx.quotation.updateMany({ where: { jobId: job.id, status: { in: ['DRAFT', 'SENT', 'REVISION_REQUESTED'] } }, data: { status: 'SUPERSEDED' } });
    const created = await tx.quotation.create({
      data: {
        reference: newRef('QUO'), jobId: job.id, version: (last?.version ?? 0) + 1,
        subtotal: priced.subtotal, discount: priced.discount, tax: priced.tax, taxRate: priced.taxRate, total: priced.total,
        diagnosis: inspection.diagnosis ?? inspection.findings, recommendedWork: inspection.recommendedAction,
        revisionReason: reason, resumeStatus,
        status: 'SENT', preparedById: req.user.id, expiresAt: new Date(Date.now() + QUOTE_VALID_DAYS * 86_400_000),
        items: { create: priced.lines },
      },
      include: { items: true },
    });
    if (job.status !== 'AWAITING_APPROVAL') await moveJob(tx, { job, to: 'AWAITING_APPROVAL', userId: req.user.id, notes: resumeStatus ? `Revised quotation ${created.reference} sent: ${reason}` : `Quotation ${created.reference} sent` });
    await notify(tx, job.booking.customer.userId, resumeStatus ? 'Revised quotation: your approval is needed' : 'Your quotation is ready',
      `Quotation ${created.reference} for booking ${job.booking.reference} is UGX ${priced.total.toLocaleString('en-UG')}.${resumeStatus ? ' Extra work was found. Please review it.' : ' Review and approve it to start the repair.'}`, 'QUOTATION_ISSUED');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_SENT', entityType: 'Quotation', entityId: created.id, newValues: { total: priced.total, revision: !!resumeStatus }, ip: req.ip });
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
// The first step writes the new status with a condition (still SENT). If two answers arrive at once, only one wins.
async function decide(req, nextStatus, extra, handler) {
  const { quotation, isOwner } = await loadQuotation(req, req.params.id);
  if (!isOwner) throw new ApiError(403, 'Only the customer who requested this repair can respond to the quotation.');
  if (quotation.status !== 'SENT') throw new ApiError(409, 'This quotation has already been answered or replaced. Refresh the page to see the latest one.');
  if (quotation.job.status !== 'AWAITING_APPROVAL') throw new ApiError(409, 'This job is not waiting for approval.');
  if (quotation.expiresAt && quotation.expiresAt < new Date()) {
    await prisma.quotation.update({ where: { id: quotation.id }, data: { status: 'EXPIRED' } });
    throw new ApiError(409, 'This quotation has expired. Ask your technician to send a new one.');
  }
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.quotation.updateMany({ where: { id: quotation.id, status: 'SENT' }, data: { status: nextStatus, ...extra } });
    if (!claimed.count) throw new ApiError(409, 'This quotation was just answered. Refresh the page to see the latest one.');
    await handler(tx, quotation);
  });
}

const technicianUserOf = async (tx, jobId) => (await tx.jobAssignment.findFirst({ where: { jobId, status: 'ACCEPTED' }, select: { technician: { select: { userId: true } } } }))?.technician.userId;

router.post('/quotations/:id/approve', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  await decide(req, 'APPROVED', { approvedById: req.user.id, approvedAt: new Date() }, async (tx, q) => {
    // An approved revision replaces the earlier approved quotation, which stays on record.
    if (q.resumeStatus) await tx.quotation.updateMany({ where: { jobId: q.jobId, status: 'APPROVED', id: { not: q.id } }, data: { status: 'SUPERSEDED' } });
    await moveJob(tx, { job: q.job, to: q.resumeStatus || 'APPROVED', userId: req.user.id, notes: `Customer approved quotation ${q.reference} (version ${q.version})` });
    const techUser = await technicianUserOf(tx, q.jobId);
    if (techUser) await notify(tx, techUser, 'Quotation approved', `The customer approved quotation ${q.reference}. ${q.resumeStatus ? 'You can continue the repair.' : 'You can start the repair.'}`, 'QUOTATION_APPROVED');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_APPROVED', entityType: 'Quotation', entityId: q.id, newValues: { total: q.total, version: q.version }, ip: req.ip });
  });
  ok(res, { id: req.params.id, status: 'APPROVED' }, 'Quotation approved');
}));

// Declining a first quotation ends the job and only the diagnostic fee is invoiced.
// Declining a revision simply returns the job to the original approved work.
router.post('/quotations/:id/reject', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  await decide(req, 'REJECTED', { revisionNote: reason }, async (tx, q) => {
    const techUser = await technicianUserOf(tx, q.jobId);
    if (q.resumeStatus) {
      await moveJob(tx, { job: q.job, to: q.resumeStatus, userId: req.user.id, notes: `Revised quotation ${q.reference} declined${reason ? `: ${reason}` : ''}. Work continues under the approved quotation.` });
      if (techUser) await notify(tx, techUser, 'Revised quotation declined', `The customer declined the extra work in ${q.reference}. Continue with the approved quotation.`, 'QUOTATION_REJECTED');
    } else {
      await tx.jobAssignment.updateMany({ where: { jobId: q.jobId, status: { in: ACTIVE_ASSIGNMENT } }, data: { status: 'COMPLETED' } });
      await moveJob(tx, { job: q.job, to: 'CANCELLED', userId: req.user.id, notes: `Quotation ${q.reference} declined${reason ? `: ${reason}` : ''}` });
      const fee = Number(q.job.booking.service.diagnosticFee || 0);
      if (fee > 0) await createInvoice(tx, { jobId: q.jobId, customerId: q.job.booking.customerId, quotationId: q.id, lines: [{ description: 'Diagnostic fee', itemType: 'FEE', quantity: 1, unitPrice: fee, totalPrice: fee }] });
      if (techUser) await notify(tx, techUser, 'Quotation declined', `The customer declined quotation ${q.reference}. The job is closed.`, 'QUOTATION_REJECTED');
    }
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_REJECTED', entityType: 'Quotation', entityId: q.id, ip: req.ip });
  });
  ok(res, { id: req.params.id, status: 'REJECTED' }, 'Quotation declined');
}));

// Ask for changes. For a first quotation the job returns to inspection so a new version can be issued.
router.post('/quotations/:id/request-revision', requireRole('CUSTOMER'), asyncHandler(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(3, 'Tell the technician what to change').max(500) }).parse(req.body);
  await decide(req, 'REVISION_REQUESTED', { revisionNote: note }, async (tx, q) => {
    if (!q.resumeStatus) await moveJob(tx, { job: q.job, to: 'INSPECTION', userId: req.user.id, notes: `Changes requested: ${note}` });
    const techUser = await technicianUserOf(tx, q.jobId);
    if (techUser) await notify(tx, techUser, 'Changes requested', `The customer asked for changes to quotation ${q.reference}: ${note}`, 'QUOTATION_REVISION');
    await audit(tx, { userId: req.user.id, action: 'QUOTATION_REVISION_REQUESTED', entityType: 'Quotation', entityId: q.id, newValues: { note }, ip: req.ip });
  });
  ok(res, { id: req.params.id, status: 'REVISION_REQUESTED' }, 'Changes requested');
}));

export default router;
