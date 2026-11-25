import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { notify, notifyOps } from '../../lib/workflow.js';
import { authenticate, isStaff } from '../../middleware/auth.js';

// Questions and answers on a booking between the customer, the assigned technician and FixPro staff.
// Used for clarification requests during review and for questions about a quotation (requirements 6.1 and 7.3).
const router = Router();
router.use(authenticate);

async function access(req) {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, reference: true, customer: { select: { userId: true } },
      jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { assignments: { where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, take: 1, select: { technician: { select: { userId: true } } } } } },
    },
  });
  if (!booking) throw new ApiError(404, 'Booking not found');
  const techUserId = booking.jobs[0]?.assignments[0]?.technician.userId ?? null;
  const isOwner = booking.customer.userId === req.user.id;
  const isTech = techUserId === req.user.id;
  if (!isStaff(req.user) && !isOwner && !isTech) throw new ApiError(404, 'Booking not found');
  return { booking, isOwner, isTech, techUserId };
}

router.get('/:id/messages', asyncHandler(async (req, res) => {
  const { booking } = await access(req);
  const rows = await prisma.bookingMessage.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'asc' }, take: 200 });
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, fullName: true } });
  const names = Object.fromEntries(authors.map((a) => [a.id, a.fullName]));
  ok(res, rows.map((r) => ({
    id: r.id, kind: r.kind, quotationId: r.quotationId, message: r.message, createdAt: r.createdAt, authorRole: r.authorRole,
    author: r.authorRole === 'STAFF' ? 'FixPro' : names[r.authorId] ?? 'Unknown',
    mine: r.authorId === req.user.id,
  })));
}));

router.post('/:id/messages', asyncHandler(async (req, res) => {
  const { message, quotationId } = z.object({ message: z.string().trim().min(1, 'Write a message').max(1000), quotationId: z.string().uuid().optional() }).parse(req.body);
  const { booking, isOwner, isTech, techUserId } = await access(req);
  const authorRole = isOwner ? 'CUSTOMER' : isTech ? 'TECHNICIAN' : 'STAFF';
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.bookingMessage.create({ data: { bookingId: booking.id, authorId: req.user.id, authorRole, quotationId, message } });
    if (isOwner) {
      if (techUserId) await notify(tx, techUserId, 'Message from the customer', `${booking.reference}: ${message.slice(0, 140)}`, 'MESSAGE');
      else await notifyOps(tx, 'Message from a customer', `${booking.reference}: ${message.slice(0, 140)}`, 'MESSAGE');
    } else {
      await notify(tx, booking.customer.userId, 'New message about your repair', `${booking.reference}: ${message.slice(0, 140)}`, 'MESSAGE');
    }
    return row;
  });
  ok(res, { id: created.id }, 'Message sent', 201);
}));

export default router;
