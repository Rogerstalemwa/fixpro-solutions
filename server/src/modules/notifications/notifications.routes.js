import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, ok } from '../../lib/http.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Counts for the navigation badge: unread updates, and (for technicians) job offers waiting for a reply.
router.get('/summary', asyncHandler(async (req, res) => {
  const technician = await prisma.technician.findUnique({ where: { userId: req.user.id }, select: { id: true } });
  const [unread, offers] = await Promise.all([
    prisma.notification.count({ where: { userId: req.user.id, readAt: null, deliveryChannel: 'IN_APP' } }),
    technician ? prisma.jobAssignment.count({ where: { technicianId: technician.id, status: 'OFFERED', job: { status: 'ASSIGNED' } } }) : 0,
  ]);
  ok(res, { unread, offers });
}));

router.get('/', asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.user.id, deliveryChannel: 'IN_APP' }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, title: true, message: true, notificationType: true, readAt: true, createdAt: true } }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null, deliveryChannel: 'IN_APP' } }),
  ]);
  ok(res, { items, unread });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, readAt: null }, data: { readAt: new Date() } });
  ok(res, null, 'Marked as read');
}));

export default router;
