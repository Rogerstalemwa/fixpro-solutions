import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PRIVATE_DIR, removeFiles, saveFile, uploadMedia } from '../../lib/uploads.js';

const router = Router();
router.use(authenticate, requireRole('CUSTOMER'));

// Every query below is scoped to this customer, so one customer can never reach another's records (BR-001).
const currentCustomer = async (req) => {
  const customer = await prisma.customer.findUnique({ where: { userId: req.user.id } });
  if (!customer) throw new ApiError(404, 'Customer profile not found');
  return customer;
};

const optional = (schema) => schema.optional().or(z.literal('').transform(() => undefined));

const deviceSchema = z.object({
  category: z.string().trim().min(1, 'Choose a device type').max(80),
  brand: optional(z.string().trim().max(80)),
  model: optional(z.string().trim().max(80)),
  serialNumber: optional(z.string().trim().max(120)),
  description: optional(z.string().trim().max(500)),
  purchaseDate: optional(
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
      .refine((v) => new Date(`${v}T00:00:00Z`) <= new Date(), 'The purchase date cannot be in the future')
      .transform((v) => new Date(`${v}T00:00:00Z`))
  ),
  notes: optional(z.string().trim().max(1000)),
});

const addressSchema = z.object({
  district: z.string().trim().min(1, 'District is required').max(80),
  town: optional(z.string().trim().max(80)),
  area: optional(z.string().trim().max(80)),
  street: optional(z.string().trim().max(160)),
  landmark: optional(z.string().trim().max(160)),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  addressNotes: optional(z.string().trim().max(500)),
  isDefault: z.boolean().optional(),
});

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { userId: req.user.id },
      include: { user: { select: { fullName: true, email: true, phone: true } } },
    });
    if (!customer) throw new ApiError(404, 'Customer profile not found');
    ok(res, customer);
  })
);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().toLowerCase().email().optional() })
      .parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: body,
      select: { fullName: true, email: true, phone: true },
    });
    ok(res, user, 'Profile updated');
  })
);

// Dashboard headline numbers: request counts by stage, money spent and money still owed.
router.get(
  '/me/summary',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const [byStatus, spent, owed, pendingQuotations, devices] = await Promise.all([
      prisma.booking.groupBy({ by: ['status'], where: { customerId: c.id }, _count: { _all: true } }),
      prisma.payment.aggregate({ where: { status: 'SUCCESSFUL', invoice: { customerId: c.id } }, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { customerId: c.id, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, _sum: { balance: true } }),
      prisma.quotation.count({ where: { status: 'SENT', job: { status: 'AWAITING_APPROVAL', booking: { customerId: c.id } } } }),
      prisma.device.count({ where: { customerId: c.id, archivedAt: null } }),
    ]);
    const count = (...statuses) => byStatus.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
    ok(res, {
      total: count(...byStatus.map((s) => s.status)),
      pending: count('NEW_REQUEST', 'UNDER_REVIEW', 'AWAITING_ASSIGNMENT', 'TECHNICIAN_ASSIGNED'),
      active: count('ACCEPTED', 'APPOINTMENT_CONFIRMED', 'IN_PROGRESS', 'AWAITING_APPROVAL'),
      completed: count('COMPLETED'),
      cancelled: count('CANCELLED', 'DISPUTED'),
      totalSpent: Number(spent._sum.amount ?? 0),
      outstanding: Number(owed._sum.balance ?? 0),
      pendingQuotations,
      devices,
    });
  })
);

// ── Devices ──
router.get(
  '/me/devices',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    ok(res, await prisma.device.findMany({ where: { customerId: c.id, archivedAt: null }, orderBy: { createdAt: 'desc' }, include: { photos: { select: { id: true } } } }));
  })
);

router.post(
  '/me/devices',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const device = await prisma.device.create({ data: { ...deviceSchema.parse(req.body), customerId: c.id } });
    ok(res, device, 'Device saved', 201);
  })
);

router.patch(
  '/me/devices/:id',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const result = await prisma.device.updateMany({
      where: { id: req.params.id, customerId: c.id, archivedAt: null },
      data: deviceSchema.partial().parse(req.body),
    });
    if (!result.count) throw new ApiError(404, 'Device not found');
    ok(res, await prisma.device.findUnique({ where: { id: req.params.id } }), 'Device updated');
  })
);

router.delete(
  '/me/devices/:id',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const result = await prisma.device.updateMany({
      where: { id: req.params.id, customerId: c.id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (!result.count) throw new ApiError(404, 'Device not found');
    res.status(204).end();
  })
);

// Photos of the device (requirements 4.4): up to 6 per device, opened only through the protected files route.
router.post(
  '/me/devices/:id/photos',
  uploadMedia.array('photos', 4),
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const device = await prisma.device.findFirst({ where: { id: req.params.id, customerId: c.id, archivedAt: null }, include: { _count: { select: { photos: true } } } });
    if (!device) throw new ApiError(404, 'Device not found');
    const files = req.files || [];
    if (!files.length) throw new ApiError(422, 'Validation failed', [{ field: 'photos', message: 'Choose at least one photo' }]);
    if (device._count.photos + files.length > 6) throw new ApiError(422, 'Validation failed', [{ field: 'photos', message: 'A device can have up to 6 photos' }]);
    const dir = path.join(PRIVATE_DIR, 'devices');
    const saved = [];
    try {
      for (const f of files) saved.push((await saveFile(f, dir, { allow: ['IMAGE'], field: 'photos', label: 'Each photo' })).name);
      const rows = await prisma.$transaction(saved.map((fileName) => prisma.devicePhoto.create({ data: { deviceId: device.id, fileName }, select: { id: true } })));
      ok(res, rows, 'Photos added', 201);
    } catch (err) {
      await removeFiles(saved.map((n) => path.join(dir, n)));
      throw err;
    }
  })
);

router.delete(
  '/me/devices/:id/photos/:photoId',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const photo = await prisma.devicePhoto.findFirst({ where: { id: req.params.photoId, deviceId: req.params.id, device: { customerId: c.id } } });
    if (!photo) throw new ApiError(404, 'Photo not found');
    await prisma.devicePhoto.delete({ where: { id: photo.id } });
    await fs.unlink(path.join(PRIVATE_DIR, 'devices', photo.fileName)).catch(() => {});
    res.status(204).end();
  })
);

// ── Addresses ──
router.get(
  '/me/addresses',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    ok(
      res,
      await prisma.customerAddress.findMany({
        where: { customerId: c.id, archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })
    );
  })
);

router.post(
  '/me/addresses',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const body = addressSchema.parse(req.body);
    const address = await prisma.$transaction(async (tx) => {
      const first = (await tx.customerAddress.count({ where: { customerId: c.id, archivedAt: null } })) === 0;
      const makeDefault = body.isDefault ?? first;
      if (makeDefault) await tx.customerAddress.updateMany({ where: { customerId: c.id }, data: { isDefault: false } });
      return tx.customerAddress.create({ data: { ...body, isDefault: makeDefault, customerId: c.id } });
    });
    ok(res, address, 'Address saved', 201);
  })
);

router.patch(
  '/me/addresses/:id',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const body = addressSchema.partial().parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const owned = await tx.customerAddress.findFirst({ where: { id: req.params.id, customerId: c.id, archivedAt: null } });
      if (!owned) throw new ApiError(404, 'Address not found');
      if (body.isDefault) await tx.customerAddress.updateMany({ where: { customerId: c.id }, data: { isDefault: false } });
      return tx.customerAddress.update({ where: { id: owned.id }, data: body });
    });
    ok(res, updated, 'Address updated');
  })
);

router.delete(
  '/me/addresses/:id',
  asyncHandler(async (req, res) => {
    const c = await currentCustomer(req);
    const result = await prisma.customerAddress.updateMany({
      where: { id: req.params.id, customerId: c.id, archivedAt: null },
      data: { archivedAt: new Date(), isDefault: false },
    });
    if (!result.count) throw new ApiError(404, 'Address not found');
    res.status(204).end();
  })
);

export default router;
