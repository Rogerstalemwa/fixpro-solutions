import crypto from 'node:crypto';

export const newRef = (prefix) =>
  `${prefix}-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;

const round2 = (n) => Math.round(n * 100) / 100;

// Totals are always computed here, never trusted from the client. The diagnostic fee comes from the catalogue.
export function priceQuotation(items, diagnosticFee) {
  const lines = [];
  const fee = Number(diagnosticFee || 0);
  if (fee > 0) lines.push({ description: 'Diagnostic fee', itemType: 'FEE', quantity: 1, unitPrice: fee, totalPrice: fee });
  for (const i of items) {
    lines.push({ description: i.description, itemType: i.itemType, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: round2(i.quantity * i.unitPrice) });
  }
  const subtotal = round2(lines.reduce((sum, l) => sum + l.totalPrice, 0));
  return { lines, subtotal, discount: 0, tax: 0, total: subtotal };
}

// Creates the invoice for a job once (idempotent). Call inside a transaction.
export async function createInvoice(tx, { jobId, customerId, quotationId, lines, dueInDays = 7 }) {
  const existing = await tx.invoice.findFirst({ where: { jobId, status: { not: 'CANCELLED' } } });
  if (existing) return existing;
  const subtotal = round2(lines.reduce((sum, l) => sum + Number(l.totalPrice), 0));
  const now = new Date();
  return tx.invoice.create({
    data: {
      reference: newRef('INV'),
      customerId,
      jobId,
      quotationId,
      subtotal,
      tax: 0,
      total: subtotal,
      amountPaid: 0,
      balance: subtotal,
      status: subtotal > 0 ? 'ISSUED' : 'PAID',
      issuedAt: now,
      dueAt: new Date(now.getTime() + dueInDays * 86_400_000),
      items: { create: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, totalPrice: l.totalPrice })) },
    },
  });
}
