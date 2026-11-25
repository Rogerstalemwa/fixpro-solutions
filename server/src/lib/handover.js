import { ApiError } from './http.js';
import { createInvoice } from './billing.js';
import { moveJob, notify } from './workflow.js';

// Marks a job ready for handover and issues the invoice from the latest approved quotation.
// Call inside a transaction.
export async function readyForHandover(tx, { job, userId, notes }) {
  const approved = await tx.quotation.findFirst({ where: { jobId: job.id, status: 'APPROVED' }, orderBy: { version: 'desc' }, include: { items: true } });
  if (!approved) throw new ApiError(409, 'There is no approved quotation for this job.');
  const booking = await tx.booking.findUnique({ where: { id: job.bookingId }, select: { customerId: true, reference: true, customer: { select: { userId: true } } } });
  await moveJob(tx, { job, to: 'READY_FOR_HANDOVER', userId, notes });
  const invoice = await createInvoice(tx, {
    jobId: job.id, customerId: booking.customerId, quotationId: approved.id, tax: Number(approved.tax),
    lines: approved.items.map((i) => ({ description: i.description, itemType: i.itemType, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice })),
  });
  await notify(tx, booking.customer.userId, 'Your repair is ready', `Your device ${booking.reference} is ready. Invoice ${invoice.reference} is UGX ${Number(invoice.total).toLocaleString('en-UG')}.`, 'READY_FOR_HANDOVER');
  return invoice;
}
