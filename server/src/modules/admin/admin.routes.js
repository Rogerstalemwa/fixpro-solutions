import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok, paginated, pageParams } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('OPERATIONS_ADMIN', 'TECHNICAL_SUPERVISOR', 'FINANCE_ADMIN'));

const adminOnly = requireRole('OPERATIONS_ADMIN');
const money = z.coerce.number().nonnegative().max(100_000_000);

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [customers, technicians, bookingsToday, awaitingAssignment, byStatus] = await Promise.all([
      prisma.customer.count(),
      prisma.technician.count({ where: { verificationStatus: 'VERIFIED' } }),
      prisma.booking.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.job.count({ where: { status: 'AWAITING_ASSIGNMENT' } }),
      prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    ok(res, {
      customers,
      verifiedTechnicians: technicians,
      bookingsToday,
      awaitingAssignment,
      bookingsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    });
  })
);

router.get(
  '/users',
  adminOnly,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const [total, data] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        select: { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true, roles: { select: { role: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    paginated(res, data, { page, limit, total });
  })
);

router.patch(
  '/users/:id/status',
  adminOnly,
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']) }).parse(req.body);
    if (req.params.id === req.user.id) throw new ApiError(409, 'You cannot change your own account status');
    const before = await prisma.user.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (!before) throw new ApiError(404, 'User not found');
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: req.params.id }, data: { status }, select: { id: true, status: true } });
      await audit(tx, { userId: req.user.id, action: 'USER_STATUS_CHANGED', entityType: 'User', entityId: req.params.id, previousValues: before, newValues: { status }, ip: req.ip });
      return updated;
    });
    ok(res, user, 'Account status updated');
  })
);

router.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const where = req.query.status ? { status: String(req.query.status) } : {};
    const [total, data] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        include: {
          service: { select: { name: true } },
          device: { select: { category: true, brand: true, model: true } },
          address: { select: { district: true, town: true, area: true } },
          customer: { select: { user: { select: { fullName: true, phone: true } } } },
          jobs: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    paginated(res, data, { page, limit, total });
  })
);

router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const where = req.query.status ? { status: String(req.query.status) } : {};
    const [total, data] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({ where, include: { booking: { select: { reference: true, status: true } } }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    ]);
    paginated(res, data, { page, limit, total });
  })
);

// ── Service catalogue management ──
const categorySchema = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).optional(), active: z.boolean().optional() });
const serviceSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  diagnosticFee: money.optional(),
  indicativePrice: money.optional(),
  pricingMethod: z.enum(['QUOTED', 'FIXED', 'DIAGNOSTIC_THEN_QUOTE']).default('QUOTED'),
  estimatedMinutes: z.number().int().positive().max(1440).optional(),
  active: z.boolean().optional(),
});

router.post('/service-categories', adminOnly, asyncHandler(async (req, res) => {
  const category = await prisma.serviceCategory.create({ data: categorySchema.parse(req.body) });
  await audit(prisma, { userId: req.user.id, action: 'CATEGORY_CREATED', entityType: 'ServiceCategory', entityId: category.id, ip: req.ip });
  ok(res, category, 'Category created', 201);
}));

router.patch('/service-categories/:id', adminOnly, asyncHandler(async (req, res) => {
  ok(res, await prisma.serviceCategory.update({ where: { id: req.params.id }, data: categorySchema.partial().parse(req.body) }), 'Category updated');
}));

router.post('/services', adminOnly, asyncHandler(async (req, res) => {
  const service = await prisma.service.create({ data: serviceSchema.parse(req.body) });
  await audit(prisma, { userId: req.user.id, action: 'SERVICE_CREATED', entityType: 'Service', entityId: service.id, ip: req.ip });
  ok(res, service, 'Service created', 201);
}));

router.patch('/services/:id', adminOnly, asyncHandler(async (req, res) => {
  ok(res, await prisma.service.update({ where: { id: req.params.id }, data: serviceSchema.partial().parse(req.body) }), 'Service updated');
}));

export default router;
