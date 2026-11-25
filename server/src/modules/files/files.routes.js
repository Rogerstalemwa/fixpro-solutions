import { Router } from 'express';
import path from 'node:path';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler } from '../../lib/http.js';
import { PRIVATE_DIR, UPLOAD_ROOT } from '../../lib/uploads.js';
import { authenticate, isStaff } from '../../middleware/auth.js';

// Private files (device photos, booking attachments, repair photos) are only opened through this route.
const router = Router();
router.use(authenticate);

// Staff, the customer who owns the booking, or the technician who accepted the job.
async function canSeeBooking(user, bookingId) {
  if (isStaff(user)) return true;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customer: { select: { userId: true } }, jobs: { select: { workshop: { select: { managerUserId: true } }, logisticsOrders: { select: { assignedPersonId: true } }, assignments: { where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, select: { technician: { select: { userId: true } } } } } } },
  });
  if (!booking) return false;
  if (booking.customer.userId === user.id) return true;
  return booking.jobs.some((j) => j.assignments.some((a) => a.technician.userId === user.id) || j.workshop?.managerUserId === user.id || j.logisticsOrders.some((o) => o.assignedPersonId === user.id));
}

const RESOLVERS = {
  'device-photo': async (id, user) => {
    const photo = await prisma.devicePhoto.findUnique({ where: { id }, include: { device: { select: { id: true, customer: { select: { userId: true } } } } } });
    if (!photo) return null;
    let allowed = isStaff(user) || photo.device.customer.userId === user.id;
    if (!allowed) {
      allowed = !!(await prisma.jobAssignment.findFirst({ where: { status: { in: ['ACCEPTED', 'COMPLETED'] }, technician: { userId: user.id }, job: { booking: { deviceId: photo.device.id } } }, select: { id: true } }));
    }
    return allowed ? `private/devices/${photo.fileName}` : null;
  },
  'booking-attachment': async (id, user) => {
    const a = await prisma.bookingAttachment.findUnique({ where: { id } });
    return a && (await canSeeBooking(user, a.bookingId)) ? a.fileReference : null;
  },
  'job-photo': async (id, user) => {
    const p = await prisma.jobPhoto.findUnique({ where: { id }, include: { job: { select: { bookingId: true } } } });
    return p && (await canSeeBooking(user, p.job.bookingId)) ? `private/jobs/${p.fileName}` : null;
  },
};

router.get('/:kind/:id', asyncHandler(async (req, res) => {
  const resolve = RESOLVERS[req.params.kind];
  if (!resolve || !/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError(404, 'File not found');
  const reference = await resolve(req.params.id, req.user);
  if (!reference) throw new ApiError(404, 'File not found');
  const file = path.resolve(UPLOAD_ROOT, reference);
  if (!file.startsWith(PRIVATE_DIR + path.sep)) throw new ApiError(404, 'File not found');
  res.set('Cache-Control', 'private, max-age=300');
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).json({ success: false, message: 'File is missing' }); });
}));

export default router;
