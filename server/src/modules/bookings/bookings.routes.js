import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { isServedDistrict } from '../../config.js';
import { ApiError, asyncHandler, ok, paginated, pageParams } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { authenticate, isStaff, requireRole } from '../../middleware/auth.js';

const router = Router();
router.use(authenticate);

const CANCELLABLE = ['NEW_REQUEST', 'UNDER_REVIEW', 'AWAITING_ASSIGNMENT', 'TECHNICIAN_ASSIGNED', 'ACCEPTED', 'APPOINTMENT_CONFIRMED'];
const EDITABLE = ['NEW_REQUEST', 'UNDER_REVIEW'];

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => new Date(`${v}T23:59:59+03:00`) >= new Date(), 'Choose today or a future date')
  .transform((v) => new Date(`${v}T00:00:00+03:00`)); // Africa/Kampala

const createSchema = z.object({
  deviceId: z.string().uuid(),
  serviceId: z.string().uuid(),
  addressId: z.string().uuid(),
  fulfilmentMethod: z.enum(['DOORSTEP', 'WORKSHOP', 'COLLECTION_DELIVERY']),
  faultDescription: z.string().trim().min(10, 'Describe the problem in at least 10 characters').max(2000),
  preferredDate: dateOnly.optional(),
  preferredTime: z.string().trim().max(40).optional(),
});

const updateSchema = z.object({
  faultDescription: createSchema.shape.faultDescription.optional(),
  preferredDate: dateOnly.optional(),
  preferredTime: z.string().trim().max(40).optional(),
});

const BOOKING_INCLUDE = {
  service: { select: { id: true, name: true, diagnosticFee: true, category: { select: { name: true } } } },
  device: true,
  address: true,
  jobs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true, status: true, createdAt: true, scheduledFor: true, scheduledWindow: true,
      assignments: {
        where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, orderBy: { assignedAt: 'desc' }, take: 1,
        select: { technician: { select: { photoUrl: true, verificationStatus: true, user: { select: { fullName: true, phone: true } } } } },
      },
      quotations: { orderBy: { version: 'desc' }, take: 1, select: { id: true, status: true, total: true } },
      invoices: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { total: true, amountPaid: true, balance: true, status: true } },
    },
  },
};

// Tabs on the customer dashboard.
const GROUPS = {
  pending: ['NEW_REQUEST', 'UNDER_REVIEW', 'AWAITING_ASSIGNMENT', 'TECHNICIAN_ASSIGNED'],
  active: ['ACCEPTED', 'APPOINTMENT_CONFIRMED', 'IN_PROGRESS', 'AWAITING_APPROVAL'],
  completed: ['COMPLETED'],
  cancelled: ['CANCELLED', 'DISPUTED'],
};

// A technician's identity is shown to the customer only after the technician has accepted.
const shapeCard = ({ jobs, ...booking }) => {
  const job = jobs[0] ?? null;
  const tech = job?.assignments[0]?.technician;
  return {
    ...booking,
    job: job && { id: job.id, status: job.status, scheduledFor: job.scheduledFor, scheduledWindow: job.scheduledWindow },
    technician: tech ? { fullName: tech.user.fullName, phone: tech.user.phone, photoUrl: tech.photoUrl, verified: tech.verificationStatus === 'VERIFIED' } : null,
    awaitingTechnician: !tech && ['TECHNICIAN_ASSIGNED'].includes(booking.status),
    quotation: job?.quotations[0] ?? null,
    invoice: job?.invoices[0] ?? null,
  };
};

// FPS-2026-4K7Q2M: unique reference; retried on the (unlikely) collision.
const newReference = () => `FPS-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;

const customerOf = async (userId) => {
  const c = await prisma.customer.findUnique({ where: { userId } });
  if (!c) throw new ApiError(403, 'A customer account is required');
  return c;
};

// Customers see only their own bookings; staff see all. Always returns a 404 rather than revealing existence.
const findAccessible = async (req, id, include = BOOKING_INCLUDE) => {
  const where = { id };
  if (!isStaff(req.user)) where.customerId = (await customerOf(req.user.id)).id;
  const booking = await prisma.booking.findFirst({ where, include });
  if (!booking) throw new ApiError(404, 'Booking not found');
  return booking;
};

router.post(
  '/',
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const customer = await customerOf(req.user.id);

    const [device, address, service] = await Promise.all([
      prisma.device.findFirst({ where: { id: body.deviceId, customerId: customer.id, archivedAt: null } }),
      prisma.customerAddress.findFirst({ where: { id: body.addressId, customerId: customer.id, archivedAt: null } }),
      prisma.service.findFirst({ where: { id: body.serviceId, active: true } }),
    ]);
    if (!device) throw new ApiError(404, 'Device not found');
    if (!address) throw new ApiError(404, 'Address not found');
    if (!service) throw new ApiError(404, 'That service is not available');
    if (!isServedDistrict(address.district)) {
      throw new ApiError(422, `We do not serve ${address.district} yet. Choose an address in a covered district.`);
    }

    // Booking, job, status history, notification and audit record succeed or fail together.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const booking = await prisma.$transaction(async (tx) => {
          const created = await tx.booking.create({
            data: {
              reference: newReference(),
              customerId: customer.id,
              deviceId: device.id,
              serviceId: service.id,
              addressId: address.id,
              fulfilmentMethod: body.fulfilmentMethod,
              faultDescription: body.faultDescription,
              preferredDate: body.preferredDate,
              preferredTime: body.preferredTime,
            },
          });
          const job = await tx.job.create({ data: { bookingId: created.id, status: 'AWAITING_ASSIGNMENT' } });
          await tx.jobStatusHistory.create({
            data: { jobId: job.id, previousStatus: null, newStatus: 'AWAITING_ASSIGNMENT', changedById: req.user.id, notes: 'Booking received' },
          });
          await tx.notification.create({
            data: {
              userId: req.user.id,
              title: 'Booking received',
              message: `We received booking ${created.reference}. Our team will assign a technician shortly.`,
              notificationType: 'BOOKING_CREATED',
            },
          });
          await audit(tx, { userId: req.user.id, action: 'BOOKING_CREATED', entityType: 'Booking', entityId: created.id, newValues: { reference: created.reference }, ip: req.ip });
          return created;
        });
        return ok(res, await prisma.booking.findUnique({ where: { id: booking.id }, include: BOOKING_INCLUDE }), 'Booking submitted', 201);
      } catch (err) {
        if (err?.code === 'P2002' && String(err.meta?.target).includes('reference')) continue;
        throw err;
      }
    }
    throw new ApiError(500, 'Could not generate a booking reference. Please try again.');
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const where = {};
    if (!isStaff(req.user)) where.customerId = (await customerOf(req.user.id)).id;
    if (req.query.group && GROUPS[req.query.group]) where.status = { in: GROUPS[req.query.group] };
    else if (req.query.status) where.status = String(req.query.status);
    const [total, data] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({ where, include: BOOKING_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    ]);
    paginated(res, data.map(shapeCard), { page, limit, total });
  })
);

// Everything about one request in a single response: schedule, technician, findings, quotation, invoice, payments and timeline.
router.get('/:id/overview', asyncHandler(async (req, res) => {
  const b = await findAccessible(req, req.params.id, {
    service: { select: { id: true, name: true, diagnosticFee: true, category: { select: { name: true } } } },
    device: true,
    address: true,
    jobs: {
      orderBy: { createdAt: 'desc' }, take: 1,
      include: {
        assignments: {
          where: { status: { in: ['OFFERED', 'ACCEPTED', 'COMPLETED'] } }, orderBy: { assignedAt: 'desc' }, take: 1,
          select: {
            status: true, acceptedAt: true,
            technician: {
              select: {
                technicianType: true, photoUrl: true, experienceSummary: true, verificationStatus: true, createdAt: true,
                user: { select: { fullName: true, phone: true } },
                coverageAreas: { where: { active: true }, select: { district: true } },
                specialisations: { take: 8, select: { service: { select: { name: true } } } },
                _count: { select: { assignments: { where: { status: 'COMPLETED' } } } },
              },
            },
          },
        },
        inspections: { orderBy: { createdAt: 'desc' }, take: 1 },
        quotations: { orderBy: { version: 'desc' }, take: 1, include: { items: true } },
        serviceReports: { orderBy: { createdAt: 'desc' }, take: 1 },
        invoices: {
          where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1,
          include: { items: true, payments: { where: { status: 'SUCCESSFUL' }, orderBy: { confirmedAt: 'asc' } } },
        },
        statusHistory: { orderBy: { createdAt: 'asc' }, select: { newStatus: true, notes: true, createdAt: true } },
      },
    },
  });
  const { jobs, ...booking } = b;
  const job = jobs[0] ?? null;
  const assignment = job?.assignments[0] ?? null;
  const revealed = assignment && ['ACCEPTED', 'COMPLETED'].includes(assignment.status);
  const invoice = job?.invoices[0] ?? null;
  ok(res, {
    booking,
    job: job && { id: job.id, status: job.status, scheduledFor: job.scheduledFor, scheduledWindow: job.scheduledWindow },
    assignmentState: !assignment ? 'NONE' : revealed ? 'CONFIRMED' : 'AWAITING_TECHNICIAN',
    technician: revealed
      ? {
          fullName: assignment.technician.user.fullName, phone: assignment.technician.user.phone, photoUrl: assignment.technician.photoUrl,
          type: assignment.technician.technicianType, about: assignment.technician.experienceSummary, acceptedAt: assignment.acceptedAt,
          verified: assignment.technician.verificationStatus === 'VERIFIED', memberSince: assignment.technician.createdAt,
          areas: [...new Set(assignment.technician.coverageAreas.map((c) => c.district))],
          services: assignment.technician.specialisations.map((x) => x.service.name),
          completedJobs: assignment.technician._count.assignments,
        }
      : null,
    inspection: job?.inspections[0] ?? null,
    quotation: job?.quotations[0] ?? null,
    serviceReport: job?.serviceReports[0] ?? null,
    invoice,
    timeline: job?.statusHistory ?? [],
  });
}));

router.get('/:id', asyncHandler(async (req, res) => ok(res, await findAccessible(req, req.params.id))));

router.patch(
  '/:id',
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const booking = await findAccessible(req, req.params.id);
    if (!EDITABLE.includes(booking.status)) throw new ApiError(409, 'This booking can no longer be changed. Contact FixPro support.');
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: updateSchema.parse(req.body),
      include: BOOKING_INCLUDE,
    });
    ok(res, updated, 'Booking updated');
  })
);

router.post(
  '/:id/cancel',
  requireRole('CUSTOMER'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const booking = await findAccessible(req, req.params.id);
    if (!CANCELLABLE.includes(booking.status)) throw new ApiError(409, 'This booking cannot be cancelled now. Contact FixPro support.');

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelReason: reason } });
      for (const job of booking.jobs) {
        await tx.job.update({ where: { id: job.id }, data: { status: 'CANCELLED' } });
        await tx.jobStatusHistory.create({
          data: { jobId: job.id, previousStatus: job.status, newStatus: 'CANCELLED', changedById: req.user.id, notes: reason ?? 'Cancelled by customer' },
        });
      }
      await audit(tx, { userId: req.user.id, action: 'BOOKING_CANCELLED', entityType: 'Booking', entityId: booking.id, previousValues: { status: booking.status }, newValues: { status: 'CANCELLED' }, ip: req.ip });
    });
    ok(res, await findAccessible(req, booking.id), 'Booking cancelled');
  })
);

const historyFor = (bookingId) =>
  prisma.jobStatusHistory.findMany({
    where: { job: { bookingId } },
    select: { previousStatus: true, newStatus: true, notes: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

router.get('/:id/history', asyncHandler(async (req, res) => {
  const booking = await findAccessible(req, req.params.id, { jobs: { select: { id: true } } });
  ok(res, await historyFor(booking.id));
}));

router.get('/:id/tracking', asyncHandler(async (req, res) => {
  const booking = await findAccessible(req, req.params.id);
  ok(res, {
    reference: booking.reference,
    bookingStatus: booking.status,
    jobStatus: booking.jobs[0]?.status ?? null,
    history: await historyFor(booking.id),
  });
}));

export default router;
