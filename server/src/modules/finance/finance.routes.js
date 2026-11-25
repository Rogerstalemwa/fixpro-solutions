import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok, paginated, pageParams } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { newRef } from '../../lib/billing.js';
import { moveJob, notify } from '../../lib/workflow.js';
import { onJobCompleted } from '../../lib/completion.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

// Mounted at /admin. Payments are recorded by operations or finance staff for now;
// mobile-money gateway callbacks (specification 6.2) come with the payments integration.
const router = Router();
router.use(authenticate, requireRole('OPERATIONS_ADMIN', 'FINANCE_ADMIN'));

const OUTSTANDING = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

router.get('/invoices', asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const where = req.query.status === 'all' ? {} : { status: { in: OUTSTANDING } };
  const [total, data] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where, skip, take: limit, orderBy: { issuedAt: 'asc' },
      include: {
        customer: { select: { user: { select: { fullName: true, phone: true } } } },
        job: { select: { status: true, booking: { select: { reference: true, service: { select: { name: true } } } } } },
      },
    }),
  ]);
  paginated(res, data, { page, limit, total });
}));

const paymentSchema = z.object({
  amount: z.coerce.number().positive('Enter the amount received').max(500_000_000),
  method: z.enum(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER']),
  reference: z.string().trim().min(3).max(100).optional(),
}).superRefine((v, ctx) => {
  if (v.method !== 'CASH' && !v.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the transaction reference' });
});

router.post('/invoices/:id/payments', asyncHandler(async (req, res) => {
  const body = paymentSchema.parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id: req.params.id }, include: { job: true, customer: { select: { userId: true } } } });
    if (!invoice) throw new ApiError(404, 'Invoice not found');
    if (!OUTSTANDING.includes(invoice.status)) throw new ApiError(409, 'This invoice is not open for payment.');
    const balance = Number(invoice.balance);
    if (body.amount > balance) throw new ApiError(422, 'Validation failed', [{ field: 'amount', message: `The balance is only UGX ${balance.toLocaleString('en-UG')}` }]);

    const newPaid = Math.round((Number(invoice.amountPaid) + body.amount) * 100) / 100;
    const newBalance = Math.round((Number(invoice.total) - newPaid) * 100) / 100;
    // Optimistic lock: fails if another payment was recorded at the same time.
    const updated = await tx.invoice.updateMany({
      where: { id: invoice.id, amountPaid: invoice.amountPaid },
      data: { amountPaid: newPaid, balance: newBalance, status: newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID' },
    });
    if (!updated.count) throw new ApiError(409, 'This invoice was just updated. Refresh and try again.');

    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id, paymentReference: newRef('PAY'), provider: 'MANUAL', providerTransactionId: body.reference,
        amount: body.amount, status: 'SUCCESSFUL', paymentMethod: body.method, confirmedAt: new Date(), recordedById: req.user.id,
      },
    });

    // A fully paid repair that is ready for handover is complete.
    // Workshop jobs complete when the device is released or delivered; the workshop sees the invoice is paid.
    if (newBalance <= 0 && invoice.job.status === 'READY_FOR_HANDOVER' && !invoice.job.assignedWorkshopId) {
      await tx.jobAssignment.updateMany({ where: { jobId: invoice.jobId, status: 'ACCEPTED' }, data: { status: 'COMPLETED' } });
      await moveJob(tx, { job: invoice.job, to: 'COMPLETED', userId: req.user.id, notes: `Invoice ${invoice.reference} paid in full` });
      await onJobCompleted(tx, invoice.jobId);
    }
    await notify(tx, invoice.customer.userId, newBalance <= 0 ? 'Payment complete' : 'Payment received', `We received UGX ${body.amount.toLocaleString('en-UG')} for invoice ${invoice.reference}.${newBalance > 0 ? ` Balance: UGX ${newBalance.toLocaleString('en-UG')}.` : ''}`, 'PAYMENT_RECEIVED');
    await audit(tx, { userId: req.user.id, action: 'PAYMENT_RECORDED', entityType: 'Invoice', entityId: invoice.id, newValues: { amount: body.amount, method: body.method }, ip: req.ip });
    return { payment, balance: newBalance };
  });
  ok(res, { paymentReference: result.payment.paymentReference, balance: result.balance }, 'Payment recorded', 201);
}));

export default router;
