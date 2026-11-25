import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config.js';
import { asyncHandler, ok } from '../../lib/http.js';

// Public information for the website. No sign-in needed and no personal data beyond a first name.
const router = Router();

router.get('/config', (_req, res) => ok(res, { contact: config.contact, districts: config.serviceDistricts }));

// Only reviews the customer agreed to publish and an administrator approved.
router.get('/testimonials', asyncHandler(async (_req, res) => {
  const reviews = await prisma.review.findMany({
    where: { approved: true, allowPublic: true, comment: { not: null } },
    orderBy: { createdAt: 'desc' }, take: 6,
    select: { rating: true, comment: true, createdAt: true, customer: { select: { user: { select: { fullName: true } } } }, job: { select: { booking: { select: { service: { select: { name: true } } } } } } },
  });
  ok(res, reviews.map((r) => ({ rating: r.rating, comment: r.comment, createdAt: r.createdAt, name: r.customer.user.fullName.split(' ')[0], service: r.job.booking.service.name })));
}));

export default router;
