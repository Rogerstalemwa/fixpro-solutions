import { Router } from 'express';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { isServedDistrict } from '../../config.js';
import { ApiError, asyncHandler, ok, paginated, pageParams } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { decryptText, encryptText, hashNin } from '../../lib/crypto.js';
import { PHOTO_DIR, PRIVATE_DIR, UPLOAD_ROOT, removeFiles, saveImage, upload } from '../../lib/uploads.js';
import { ACTIVE_ASSIGNMENT, moveJob, notify } from '../../lib/workflow.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { normalisePhone, startSession, publicUser, withRoles } from '../auth/auth.routes.js';

const router = Router();
const TECH_ROLES = ['COMPANY_TECHNICIAN', 'INDEPENDENT_TECHNICIAN'];
const asTechnician = [authenticate, requireRole(...TECH_ROLES)];
const ops = [authenticate, requireRole('OPERATIONS_ADMIN')];

const currentTechnician = async (req) => {
  const technician = await prisma.technician.findUnique({ where: { userId: req.user.id } });
  if (!technician) throw new ApiError(403, 'A technician profile is required');
  return technician;
};

// Never return ninHash or ninEncrypted from any endpoint except the audited reveal below.
const SAFE_TECHNICIAN = {
  id: true, technicianType: true, verificationStatus: true, available: true, photoUrl: true, ninLast4: true,
  dateOfBirth: true, residenceDistrict: true, residenceTown: true, residenceAddress: true,
  nextOfKinName: true, nextOfKinPhone: true, experienceSummary: true, createdAt: true,
};

// ───────── Validation ─────────
const phone = z.string().trim().transform(normalisePhone).refine((v) => /^\+256\d{9}$/.test(v), 'Enter a valid Ugandan phone number, e.g. 0700 000 000');
const list = (item, min, message) => z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(item).min(min, message).max(40));
const nin = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{14}$/, 'A National ID Number (NIN) has 14 letters and numbers');

const adult = (value) => {
  const born = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 18 && age <= 80;
};

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  phone,
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('').transform(() => undefined)),
  password: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
  nin,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth').refine(adult, 'You must be at least 18 years old'),
  residenceDistrict: z.string().trim().min(2, 'District is required').max(80),
  residenceTown: z.string().trim().max(80).optional(),
  residenceAddress: z.string().trim().min(3, 'Enter where you live').max(200),
  nextOfKinName: z.string().trim().min(2, 'Next of kin name is required').max(120),
  nextOfKinPhone: phone,
  experienceSummary: z.string().trim().min(20, 'Tell us about your experience (at least 20 characters)').max(1000),
  consent: z.preprocess((v) => v === 'true' || v === true, z.literal(true, { errorMap: () => ({ message: 'Please confirm to continue' }) })),
  districts: list(z.string().trim().min(1), 1, 'Choose at least one area you cover'),
  serviceIds: list(z.string().uuid(), 1, 'Choose at least one service you can repair'),
});

const ninFields = (value) => ({ ninHash: hashNin(value), ninEncrypted: encryptText(value), ninLast4: value.slice(-4) });

// ───────── Public: technician registration (multipart) ─────────
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.post(
  '/technicians/register',
  registerLimiter,
  upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'idDocument', maxCount: 1 }]),
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    if (!isServedDistrictList(body.districts)) throw new ApiError(422, 'Validation failed', [{ field: 'districts', message: 'Choose districts we currently serve' }]);

    const services = await prisma.service.count({ where: { id: { in: body.serviceIds }, active: true } });
    if (services !== new Set(body.serviceIds).size) throw new ApiError(422, 'Validation failed', [{ field: 'serviceIds', message: 'One of the chosen services is not available' }]);

    const clash = await prisma.user.findFirst({ where: { OR: [{ phone: body.phone }, ...(body.email ? [{ email: body.email }] : [])] }, select: { id: true } });
    if (clash) throw new ApiError(409, 'An account with this phone number or email already exists');
    if (await prisma.technician.findUnique({ where: { ninHash: hashNin(body.nin) }, select: { id: true } })) {
      throw new ApiError(409, 'An application with this National ID already exists. Contact FixPro support if this is a mistake.');
    }

    const photo = await saveImage(req.files?.photo?.[0], PHOTO_DIR, 'photo', 'A clear photo of your face');
    let idDoc;
    try {
      idDoc = await saveImage(req.files?.idDocument?.[0], PRIVATE_DIR, 'idDocument', 'A photo of your National ID');
    } catch (err) {
      await removeFiles([path.join(PHOTO_DIR, photo)]);
      throw err;
    }

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            fullName: body.fullName, phone: body.phone, email: body.email, status: 'ACTIVE',
            passwordHash: await bcrypt.hash(body.password, 12),
            roles: { create: { role: { connectOrCreate: { where: { name: 'INDEPENDENT_TECHNICIAN' }, create: { name: 'INDEPENDENT_TECHNICIAN' } } } } },
            technician: {
              create: {
                technicianType: 'INDEPENDENT',
                verificationStatus: 'PENDING_REVIEW',
                available: false,
                photoUrl: `/uploads/photos/${photo}`,
                ...ninFields(body.nin),
                dateOfBirth: new Date(`${body.dateOfBirth}T00:00:00Z`),
                residenceDistrict: body.residenceDistrict, residenceTown: body.residenceTown, residenceAddress: body.residenceAddress,
                nextOfKinName: body.nextOfKinName, nextOfKinPhone: body.nextOfKinPhone,
                experienceSummary: body.experienceSummary,
                specialisations: { create: [...new Set(body.serviceIds)].map((serviceId) => ({ serviceId })) },
                coverageAreas: { create: [...new Set(body.districts)].map((district) => ({ district })) },
                documents: { create: [{ documentType: 'NATIONAL_ID', fileReference: `private/${idDoc}` }] },
              },
            },
          },
          include: { ...withRoles, technician: { select: { id: true } } },
        });
        await audit(tx, { userId: created.id, action: 'TECHNICIAN_APPLIED', entityType: 'Technician', entityId: created.technician.id, ip: req.ip });
        const staff = await tx.user.findMany({ where: { roles: { some: { role: { name: { in: ['OPERATIONS_ADMIN', 'SUPER_ADMIN'] } } } } }, select: { id: true } });
        for (const s of staff) await notify(tx, s.id, 'New technician application', `${body.fullName} applied to join FixPro and is waiting for verification.`, 'TECHNICIAN_APPLIED');
        return created;
      });
      const accessToken = startSession(res, user);
      ok(res, { user: publicUser(user), accessToken, verificationStatus: 'PENDING_REVIEW' }, 'Application received', 201);
    } catch (err) {
      await removeFiles([path.join(PHOTO_DIR, photo), path.join(PRIVATE_DIR, idDoc)]);
      throw err;
    }
  })
);

function isServedDistrictList(districts) {
  return districts.every((d) => isServedDistrict(d));
}

// ───────── Technician self-service ─────────
router.get('/technicians/me', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await prisma.technician.findUnique({
    where: { userId: req.user.id },
    select: {
      ...SAFE_TECHNICIAN,
      user: { select: { fullName: true, phone: true, email: true } },
      coverageAreas: { where: { active: true }, select: { district: true, town: true } },
      specialisations: { select: { service: { select: { id: true, name: true } } } },
    },
  });
  if (!t) throw new ApiError(403, 'A technician profile is required');
  ok(res, t);
}));

router.patch('/technicians/me', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const body = z.object({ experienceSummary: z.string().trim().min(20).max(1000) }).parse(req.body);
  ok(res, await prisma.technician.update({ where: { id: t.id }, data: body, select: { experienceSummary: true } }), 'Profile updated');
}));

router.post('/technicians/me/photo', ...asTechnician, upload.single('photo'), asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const name = await saveImage(req.file, PHOTO_DIR, 'photo', 'A clear photo of your face');
  const updated = await prisma.technician.update({ where: { id: t.id }, data: { photoUrl: `/uploads/photos/${name}` }, select: { photoUrl: true } });
  ok(res, updated, 'Photo updated');
}));

router.get('/technicians/me/availability', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  ok(res, { available: t.available, verificationStatus: t.verificationStatus });
}));

router.patch('/technicians/me/availability', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const { available } = z.object({ available: z.boolean() }).parse(req.body);
  if (available && t.verificationStatus !== 'VERIFIED') throw new ApiError(409, 'Your account must be verified before you can receive jobs.');
  ok(res, await prisma.technician.update({ where: { id: t.id }, data: { available }, select: { available: true } }), 'Availability updated');
}));

// Customer contact details and the exact address are revealed only after the technician accepts.
router.get('/technicians/me/jobs', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const assignments = await prisma.jobAssignment.findMany({
    where: { technicianId: t.id, status: { in: ACTIVE_ASSIGNMENT }, job: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    orderBy: { assignedAt: 'desc' },
    include: {
      job: {
        include: {
          booking: {
            include: {
              service: { select: { name: true, diagnosticFee: true, category: { select: { name: true } } } },
              device: true,
              address: true,
              customer: { select: { user: { select: { fullName: true, phone: true } } } },
            },
          },
          inspections: { orderBy: { createdAt: 'desc' }, take: 1 },
          quotations: { orderBy: { version: 'desc' }, take: 1, select: { id: true, status: true, total: true, version: true, revisionNote: true } },
          serviceReports: { take: 1, select: { id: true } },
        },
      },
    },
  });
  ok(res, assignments.map((a) => {
    const { booking, inspections, quotations, serviceReports, ...job } = a.job;
    const accepted = a.status === 'ACCEPTED';
    return {
      assignmentId: a.id,
      assignmentStatus: a.status,
      assignedAt: a.assignedAt,
      job: { id: job.id, status: job.status, scheduledFor: job.scheduledFor, scheduledWindow: job.scheduledWindow },
      inspection: inspections[0] ?? null,
      quotation: quotations[0] ?? null,
      hasServiceReport: serviceReports.length > 0,
      booking: {
        reference: booking.reference,
        fulfilmentMethod: booking.fulfilmentMethod,
        faultDescription: booking.faultDescription,
        preferredDate: booking.preferredDate,
        preferredTime: booking.preferredTime,
        service: booking.service,
        device: booking.device,
        address: accepted ? booking.address : { district: booking.address.district, town: booking.address.town, area: booking.address.area },
        customer: accepted ? booking.customer.user : null,
      },
    };
  }));
}));

// ── Accept or decline an offered job (:id is the job id) ──
router.post('/technician/jobs/:id/accept', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  await prisma.$transaction(async (tx) => {
    const assignment = await tx.jobAssignment.findFirst({ where: { jobId: req.params.id, technicianId: t.id, status: 'OFFERED' }, include: { job: true } });
    if (!assignment || assignment.job.status !== 'ASSIGNED') throw new ApiError(409, 'This assignment is no longer available.');
    const claimed = await tx.jobAssignment.updateMany({ where: { id: assignment.id, status: 'OFFERED' }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    if (!claimed.count) throw new ApiError(409, 'This assignment is no longer available.');
    await moveJob(tx, { job: assignment.job, to: 'ACCEPTED', userId: req.user.id, notes: 'Technician accepted the job' });
    const booking = await tx.booking.findUnique({ where: { id: assignment.job.bookingId }, select: { reference: true, customer: { select: { userId: true } } } });
    await notify(tx, booking.customer.userId, 'Technician confirmed', `A technician has accepted your booking ${booking.reference}. Open your dashboard to see who is coming.`, 'TECHNICIAN_ACCEPTED');
    await audit(tx, { userId: req.user.id, action: 'JOB_ACCEPTED', entityType: 'Job', entityId: assignment.jobId, ip: req.ip });
  });
  ok(res, { jobId: req.params.id, status: 'ACCEPTED' }, 'Job accepted');
}));

router.post('/technician/jobs/:id/decline', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(500) }).parse(req.body);
  await prisma.$transaction(async (tx) => {
    const assignment = await tx.jobAssignment.findFirst({ where: { jobId: req.params.id, technicianId: t.id, status: 'OFFERED' }, include: { job: true } });
    if (!assignment || assignment.job.status !== 'ASSIGNED') throw new ApiError(409, 'This assignment is no longer available.');
    const claimed = await tx.jobAssignment.updateMany({ where: { id: assignment.id, status: 'OFFERED' }, data: { status: 'DECLINED', declinedReason: reason } });
    if (!claimed.count) throw new ApiError(409, 'This assignment is no longer available.');
    await moveJob(tx, { job: assignment.job, to: 'AWAITING_ASSIGNMENT', userId: req.user.id, notes: `Declined by technician: ${reason}` });
    await audit(tx, { userId: req.user.id, action: 'JOB_DECLINED', entityType: 'Job', entityId: assignment.jobId, newValues: { reason }, ip: req.ip });
  });
  ok(res, { jobId: req.params.id, status: 'AWAITING_ASSIGNMENT' }, 'Job declined and returned to dispatch');
}));

// ───────── Operations: technician management ─────────
router.get('/admin/technicians', ...ops, asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const where = {};
  if (req.query.verificationStatus) where.verificationStatus = String(req.query.verificationStatus);
  if (req.query.search) {
    const q = String(req.query.search).trim().slice(0, 60);
    where.user = { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] };
  }
  const [total, data] = await Promise.all([
    prisma.technician.count({ where }),
    prisma.technician.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        ...SAFE_TECHNICIAN,
        user: { select: { fullName: true, phone: true, email: true, status: true } },
        coverageAreas: { select: { district: true } },
        specialisations: { select: { service: { select: { name: true } } } },
        documents: { select: { id: true, documentType: true, verificationStatus: true } },
      },
    }),
  ]);
  paginated(res, data, { page, limit, total });
}));


// Full application view for operations. The NIN stays masked here; revealing it is a separate audited action.
router.get('/admin/technicians/:id', ...ops, asyncHandler(async (req, res) => {
  const t = await prisma.technician.findUnique({
    where: { id: req.params.id },
    select: {
      ...SAFE_TECHNICIAN,
      user: { select: { id: true, fullName: true, phone: true, email: true, status: true, createdAt: true, lastLoginAt: true } },
      coverageAreas: { select: { district: true, town: true, active: true } },
      specialisations: { select: { service: { select: { id: true, name: true, category: { select: { name: true } } } } } },
      documents: { select: { id: true, documentType: true, verificationStatus: true, createdAt: true } },
    },
  });
  if (!t) throw new ApiError(404, 'Technician not found');
  const [work, history] = await Promise.all([
    prisma.jobAssignment.groupBy({ by: ['status'], where: { technicianId: t.id }, _count: { _all: true } }),
    prisma.auditLog.findMany({ where: { entityType: 'Technician', entityId: t.id }, orderBy: { createdAt: 'asc' }, select: { action: true, newValues: true, userId: true, createdAt: true } }),
  ]);
  const actorIds = [...new Set(history.map((h) => h.userId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }) : [];
  const names = Object.fromEntries(actors.map((a) => [a.id, a.fullName]));
  ok(res, {
    ...t,
    work: Object.fromEntries(work.map((g) => [g.status, g._count._all])),
    history: history.map((h) => ({ action: h.action, newValues: h.newValues, by: names[h.userId] ?? null, createdAt: h.createdAt })),
  });
}));

// Reading a full NIN or an ID document is a deliberate, audited action.
router.post('/admin/technicians/:id/reveal-nin', ...ops, asyncHandler(async (req, res) => {
  const t = await prisma.technician.findUnique({ where: { id: req.params.id }, select: { id: true, ninEncrypted: true } });
  if (!t?.ninEncrypted) throw new ApiError(404, 'No NIN on file for this technician');
  await audit(prisma, { userId: req.user.id, action: 'TECHNICIAN_NIN_VIEWED', entityType: 'Technician', entityId: t.id, ip: req.ip });
  res.set('Cache-Control', 'no-store');
  ok(res, { nin: decryptText(t.ninEncrypted) });
}));

router.get('/admin/technicians/:id/documents/:docId/file', ...ops, asyncHandler(async (req, res) => {
  const doc = await prisma.technicianDocument.findFirst({ where: { id: req.params.docId, technicianId: req.params.id } });
  if (!doc) throw new ApiError(404, 'Document not found');
  const file = path.resolve(UPLOAD_ROOT, doc.fileReference);
  if (!file.startsWith(PRIVATE_DIR + path.sep)) throw new ApiError(404, 'Document not found');
  await audit(prisma, { userId: req.user.id, action: 'TECHNICIAN_DOCUMENT_VIEWED', entityType: 'TechnicianDocument', entityId: doc.id, ip: req.ip });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).json({ success: false, message: 'File is missing' }); });
}));

// Operations can create company technicians. They finish their profile (photo) from their own account.
const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone,
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).regex(/[A-Za-z]/).regex(/\d/),
  nin,
  technicianType: z.enum(['COMPANY', 'INDEPENDENT']),
  districts: z.array(z.string().trim().min(1)).min(1),
  serviceIds: z.array(z.string().uuid()).min(1),
});

router.post('/admin/technicians', ...ops, asyncHandler(async (req, res) => {
  const b = createSchema.parse(req.body);
  if (await prisma.technician.findUnique({ where: { ninHash: hashNin(b.nin) }, select: { id: true } })) throw new ApiError(409, 'A technician with this NIN already exists');
  const roleName = b.technicianType === 'COMPANY' ? 'COMPANY_TECHNICIAN' : 'INDEPENDENT_TECHNICIAN';
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        fullName: b.fullName, phone: b.phone, email: b.email, status: 'ACTIVE',
        passwordHash: await bcrypt.hash(b.password, 12),
        roles: { create: { role: { connectOrCreate: { where: { name: roleName }, create: { name: roleName } } } } },
        technician: {
          create: {
            technicianType: b.technicianType, verificationStatus: 'PENDING_REVIEW', ...ninFields(b.nin),
            specialisations: { create: b.serviceIds.map((serviceId) => ({ serviceId })) },
            coverageAreas: { create: b.districts.map((district) => ({ district })) },
          },
        },
      },
      select: { id: true, fullName: true, phone: true, technician: { select: { id: true, verificationStatus: true } } },
    });
    await audit(tx, { userId: req.user.id, action: 'TECHNICIAN_CREATED', entityType: 'Technician', entityId: created.technician.id, ip: req.ip });
    return created;
  });
  ok(res, user, 'Technician created and awaiting verification', 201);
}));

router.patch('/admin/technicians/:id/verify', ...ops, asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['VERIFIED', 'REJECTED', 'SUSPENDED']) }).parse(req.body);
  const before = await prisma.technician.findUnique({ where: { id: req.params.id }, select: { verificationStatus: true, photoUrl: true, ninHash: true, _count: { select: { documents: true } } } });
  if (!before) throw new ApiError(404, 'Technician not found');
  if (status === 'VERIFIED') {
    const missing = [!before.ninHash && 'National ID number', !before.photoUrl && 'profile photo', !before._count.documents && 'ID document'].filter(Boolean);
    if (missing.length) throw new ApiError(422, `Cannot verify yet. Missing: ${missing.join(', ')}.`);
  }
  const technician = await prisma.$transaction(async (tx) => {
    const updated = await tx.technician.update({
      where: { id: req.params.id },
      data: { verificationStatus: status, ...(status !== 'VERIFIED' && { available: false }) },
      select: { id: true, userId: true, verificationStatus: true, available: true },
    });
    if (status === 'VERIFIED') await tx.technicianDocument.updateMany({ where: { technicianId: updated.id }, data: { verificationStatus: 'VERIFIED' } });
    await notify(tx, updated.userId, status === 'VERIFIED' ? 'You are verified' : 'Application update', status === 'VERIFIED' ? 'Your account is verified. Go available to start receiving jobs.' : `Your application status is now ${status.toLowerCase()}. Contact FixPro support for details.`, 'TECHNICIAN_VERIFICATION');
    await audit(tx, { userId: req.user.id, action: 'TECHNICIAN_VERIFICATION', entityType: 'Technician', entityId: updated.id, previousValues: { verificationStatus: before.verificationStatus }, newValues: { verificationStatus: status }, ip: req.ip });
    return updated;
  });
  ok(res, technician, 'Verification status updated');
}));

export default router;
