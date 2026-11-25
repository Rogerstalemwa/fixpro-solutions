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
import { PHOTO_DIR, PRIVATE_DIR, UPLOAD_ROOT, removeFiles, saveFile, uploadMedia } from '../../lib/uploads.js';
import { ACTIVE_ASSIGNMENT, moveJob, notify, notifyOps } from '../../lib/workflow.js';
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
  yearsOfExperience: true, qualifications: true, maxTravelKm: true, workingDays: true, workStart: true, workEnd: true,
  unavailableFrom: true, unavailableUntil: true, unavailableReason: true, infoRequestNote: true,
};

// ───────── Validation ─────────
const phone = z.string().trim().transform(normalisePhone).refine((v) => /^\+256\d{9}$/.test(v), 'Enter a valid Ugandan phone number, e.g. 0700 000 000');
const optionalPhone = phone.optional().or(z.literal('').transform(() => undefined));
const optionalText = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
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
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
  nin,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth').refine(adult, 'You must be at least 18 years old'),
  residenceDistrict: z.string().trim().min(2, 'District is required').max(80),
  residenceTown: optionalText(80),
  residenceAddress: z.string().trim().min(3, 'Enter where you live or work').max(200),
  nextOfKinName: z.string().trim().min(2, 'Next of kin name is required').max(120),
  nextOfKinPhone: phone,
  qualifications: z.string().trim().min(3, 'List your technical qualifications').max(500),
  yearsOfExperience: z.coerce.number({ invalid_type_error: 'Enter your years of experience' }).int().min(0).max(60),
  experienceSummary: z.string().trim().min(20, 'Tell us about your experience (at least 20 characters)').max(1000),
  referee1Name: optionalText(120), referee1Phone: optionalPhone, referee1Relationship: optionalText(80),
  referee2Name: optionalText(120), referee2Phone: optionalPhone, referee2Relationship: optionalText(80),
  consent: z.preprocess((v) => v === 'true' || v === true, z.literal(true, { errorMap: () => ({ message: 'Please confirm to continue' }) })),
  districts: list(z.string().trim().min(1), 1, 'Choose at least one area you cover'),
  serviceIds: list(z.string().uuid(), 1, 'Choose at least one service you can repair'),
}).superRefine((v, ctx) => {
  for (const n of [1, 2]) {
    if (!!v[`referee${n}Name`] !== !!v[`referee${n}Phone`]) ctx.addIssue({ code: 'custom', path: [`referee${n}Phone`], message: 'Give both a name and a phone number for the referee' });
  }
});

const ninFields = (value) => ({ ninHash: hashNin(value), ninEncrypted: encryptText(value), ninLast4: value.slice(-4) });
const label = (f) => path.basename(String(f.originalname || 'Document')).slice(0, 80);

// ───────── Public: technician registration (multipart) ─────────
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const docUpload = uploadMedia.fields([{ name: 'photo', maxCount: 1 }, { name: 'idDocument', maxCount: 1 }, { name: 'documents', maxCount: 5 }]);

router.post('/technicians/register', registerLimiter, docUpload, asyncHandler(async (req, res) => {
  const body = registerSchema.parse(req.body);
  if (!body.districts.every((d) => isServedDistrict(d))) throw new ApiError(422, 'Validation failed', [{ field: 'districts', message: 'Choose districts we currently serve' }]);
  const services = await prisma.service.count({ where: { id: { in: body.serviceIds }, active: true } });
  if (services !== new Set(body.serviceIds).size) throw new ApiError(422, 'Validation failed', [{ field: 'serviceIds', message: 'One of the chosen services is not available' }]);
  const clash = await prisma.user.findFirst({ where: { OR: [{ phone: body.phone }, { email: body.email }] }, select: { id: true } });
  if (clash) throw new ApiError(409, 'An account with this phone number or email already exists');
  if (await prisma.technician.findUnique({ where: { ninHash: hashNin(body.nin) }, select: { id: true } })) {
    throw new ApiError(409, 'An application with this National ID already exists. Contact FixPro support if this is a mistake.');
  }

  const saved = [];
  const remember = (dir, name) => { saved.push(path.join(dir, name)); return name; };
  try {
    const photo = remember(PHOTO_DIR, (await saveFile(req.files?.photo?.[0], PHOTO_DIR, { allow: ['IMAGE'], field: 'photo', label: 'Your photo' })).name);
    const idDoc = remember(PRIVATE_DIR, (await saveFile(req.files?.idDocument?.[0], PRIVATE_DIR, { allow: ['IMAGE', 'DOCUMENT'], field: 'idDocument', label: 'The National ID' })).name);
    const supportFiles = req.files?.documents || [];
    if (!supportFiles.length) throw new ApiError(422, 'Validation failed', [{ field: 'documents', message: 'Upload at least one certificate or supporting document' }]);
    const supporting = [];
    for (const f of supportFiles) supporting.push({ name: remember(PRIVATE_DIR, (await saveFile(f, PRIVATE_DIR, { allow: ['IMAGE', 'DOCUMENT'], field: 'documents', label: 'Each document' })).name), label: label(f) });

    const referees = [1, 2].filter((n) => body[`referee${n}Name`]).map((n) => ({ name: body[`referee${n}Name`], phone: body[`referee${n}Phone`], relationship: body[`referee${n}Relationship`] }));
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName: body.fullName, phone: body.phone, email: body.email, status: 'ACTIVE', preferredContact: 'SMS',
          passwordHash: await bcrypt.hash(body.password, 12),
          roles: { create: { role: { connectOrCreate: { where: { name: 'INDEPENDENT_TECHNICIAN' }, create: { name: 'INDEPENDENT_TECHNICIAN' } } } } },
          technician: {
            create: {
              technicianType: 'INDEPENDENT', verificationStatus: 'PENDING_REVIEW', available: false,
              photoUrl: `/uploads/photos/${photo}`, ...ninFields(body.nin),
              dateOfBirth: new Date(`${body.dateOfBirth}T00:00:00Z`),
              residenceDistrict: body.residenceDistrict, residenceTown: body.residenceTown, residenceAddress: body.residenceAddress,
              nextOfKinName: body.nextOfKinName, nextOfKinPhone: body.nextOfKinPhone,
              qualifications: body.qualifications, yearsOfExperience: body.yearsOfExperience, experienceSummary: body.experienceSummary,
              specialisations: { create: [...new Set(body.serviceIds)].map((serviceId) => ({ serviceId })) },
              coverageAreas: { create: [...new Set(body.districts)].map((district) => ({ district })) },
              referees: { create: referees },
              documents: { create: [{ documentType: 'NATIONAL_ID', fileReference: `private/${idDoc}` }, ...supporting.map((d) => ({ documentType: 'SUPPORTING', label: d.label, fileReference: `private/${d.name}` }))] },
            },
          },
        },
        include: { ...withRoles, technician: { select: { id: true } } },
      });
      await audit(tx, { userId: created.id, action: 'TECHNICIAN_APPLIED', entityType: 'Technician', entityId: created.technician.id, ip: req.ip });
      await notifyOps(tx, 'New technician application', `${body.fullName} applied to join FixPro and is waiting for review.`, 'TECHNICIAN_APPLIED');
      return created;
    });
    const accessToken = startSession(res, user);
    ok(res, { user: publicUser(user), accessToken, verificationStatus: 'PENDING_REVIEW' }, 'Application received', 201);
  } catch (err) {
    await removeFiles(saved);
    throw err;
  }
}));

// ───────── Technician self-service ─────────
router.get('/technicians/me', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await prisma.technician.findUnique({
    where: { userId: req.user.id },
    select: {
      ...SAFE_TECHNICIAN,
      user: { select: { fullName: true, phone: true, email: true } },
      coverageAreas: { where: { active: true }, select: { district: true, town: true } },
      specialisations: { select: { service: { select: { id: true, name: true } } } },
      documents: { select: { id: true, documentType: true, label: true, verificationStatus: true, createdAt: true } },
      referees: { select: { name: true, phone: true, relationship: true } },
    },
  });
  if (!t) throw new ApiError(403, 'A technician profile is required');
  ok(res, t);
}));

router.patch('/technicians/me', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const body = z.object({
    experienceSummary: z.string().trim().min(20).max(1000).optional(),
    qualifications: z.string().trim().min(3).max(500).optional(),
    yearsOfExperience: z.coerce.number().int().min(0).max(60).optional(),
  }).parse(req.body);
  ok(res, await prisma.technician.update({ where: { id: t.id }, data: body, select: { experienceSummary: true, qualifications: true, yearsOfExperience: true } }), 'Profile updated');
}));

router.post('/technicians/me/photo', ...asTechnician, uploadMedia.single('photo'), asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const { name } = await saveFile(req.file, PHOTO_DIR, { allow: ['IMAGE'], field: 'photo', label: 'Your photo' });
  ok(res, await prisma.technician.update({ where: { id: t.id }, data: { photoUrl: `/uploads/photos/${name}` }, select: { photoUrl: true } }), 'Photo updated');
}));

// Extra documents, for example when FixPro asks for more information.
router.post('/technicians/me/documents', ...asTechnician, uploadMedia.array('documents', 5), asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  if (!['PENDING_REVIEW', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED'].includes(t.verificationStatus)) throw new ApiError(409, 'Documents can only be added while your application is being reviewed.');
  const files = req.files || [];
  if (!files.length) throw new ApiError(422, 'Validation failed', [{ field: 'documents', message: 'Choose at least one file' }]);
  const saved = [];
  try {
    for (const f of files) saved.push({ ...(await saveFile(f, PRIVATE_DIR, { allow: ['IMAGE', 'DOCUMENT'], field: 'documents', label: 'Each document' })), label: label(f) });
    await prisma.technicianDocument.createMany({ data: saved.map((d) => ({ technicianId: t.id, documentType: 'SUPPORTING', label: d.label, fileReference: `private/${d.name}` })) });
  } catch (err) { await removeFiles(saved.map((d) => path.join(PRIVATE_DIR, d.name))); throw err; }
  ok(res, { added: saved.length }, 'Documents added', 201);
}));

// After FixPro asked for more information, send the application back for review.
router.post('/technicians/me/resubmit', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  if (t.verificationStatus !== 'ADDITIONAL_INFO_REQUIRED') throw new ApiError(409, 'There is nothing to resubmit.');
  await prisma.$transaction(async (tx) => {
    await tx.technician.update({ where: { id: t.id }, data: { verificationStatus: 'PENDING_REVIEW' } });
    await notifyOps(tx, 'Technician updated their application', `${req.user.id === t.userId ? 'A technician' : 'A technician'} resubmitted their application for review.`, 'TECHNICIAN_RESUBMITTED');
    await audit(tx, { userId: req.user.id, action: 'TECHNICIAN_RESUBMITTED', entityType: 'Technician', entityId: t.id, ip: req.ip });
  });
  ok(res, { verificationStatus: 'PENDING_REVIEW' }, 'Application sent for review');
}));

router.get('/technicians/me/availability', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  ok(res, { available: t.available, verificationStatus: t.verificationStatus });
}));

router.patch('/technicians/me/availability', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const { available } = z.object({ available: z.boolean() }).parse(req.body);
  if (available && t.verificationStatus !== 'VERIFIED') throw new ApiError(409, 'Your account must be approved before you can receive jobs.');
  ok(res, await prisma.technician.update({ where: { id: t.id }, data: { available }, select: { available: true } }), 'Availability updated');
}));

// Working days and hours, travel distance and time off (requirements 5.3).
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the format HH:MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD').nullable().optional();
const scheduleSchema = z.object({
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one working day').max(7),
  workStart: hhmm, workEnd: hhmm,
  maxTravelKm: z.number().int().min(1).max(500).nullable().optional(),
  unavailableFrom: day, unavailableUntil: day,
  unavailableReason: z.string().trim().max(200).nullable().optional(),
}).refine((v) => v.workEnd > v.workStart, { path: ['workEnd'], message: 'Finishing time must be after the starting time' })
  .refine((v) => !!v.unavailableFrom === !!v.unavailableUntil, { path: ['unavailableUntil'], message: 'Give both the first and last day off' })
  .refine((v) => !v.unavailableFrom || v.unavailableUntil >= v.unavailableFrom, { path: ['unavailableUntil'], message: 'The last day off cannot be before the first' });

router.put('/technicians/me/schedule', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const v = scheduleSchema.parse(req.body);
  const updated = await prisma.technician.update({
    where: { id: t.id },
    data: {
      workingDays: [...new Set(v.workingDays)].sort(), workStart: v.workStart, workEnd: v.workEnd, maxTravelKm: v.maxTravelKm ?? null,
      unavailableFrom: v.unavailableFrom ? new Date(`${v.unavailableFrom}T00:00:00+03:00`) : null,
      unavailableUntil: v.unavailableUntil ? new Date(`${v.unavailableUntil}T23:59:59+03:00`) : null,
      unavailableReason: v.unavailableReason || null,
    },
    select: { workingDays: true, workStart: true, workEnd: true, maxTravelKm: true, unavailableFrom: true, unavailableUntil: true, unavailableReason: true },
  });
  ok(res, updated, 'Schedule saved');
}));

router.put('/technicians/me/coverage', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const { districts } = z.object({ districts: z.array(z.string().trim().min(1)).min(1, 'Choose at least one area').max(40) }).parse(req.body);
  if (!districts.every((d) => isServedDistrict(d))) throw new ApiError(422, 'Validation failed', [{ field: 'districts', message: 'Choose districts we currently serve' }]);
  await prisma.$transaction([
    prisma.technicianCoverageArea.deleteMany({ where: { technicianId: t.id } }),
    prisma.technicianCoverageArea.createMany({ data: [...new Set(districts)].map((district) => ({ technicianId: t.id, district })) }),
  ]);
  ok(res, { districts }, 'Areas saved');
}));

router.put('/technicians/me/specialisations', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const { serviceIds } = z.object({ serviceIds: z.array(z.string().uuid()).min(1, 'Choose at least one service').max(60) }).parse(req.body);
  const ids = [...new Set(serviceIds)];
  if ((await prisma.service.count({ where: { id: { in: ids }, active: true } })) !== ids.length) throw new ApiError(422, 'Validation failed', [{ field: 'serviceIds', message: 'One of the chosen services is not available' }]);
  await prisma.$transaction([
    prisma.technicianSpecialisation.deleteMany({ where: { technicianId: t.id } }),
    prisma.technicianSpecialisation.createMany({ data: ids.map((serviceId) => ({ technicianId: t.id, serviceId })) }),
  ]);
  ok(res, { serviceIds: ids }, 'Services saved');
}));

// ───────── Job lists and dashboard (requirements 5.4) ─────────
const IN_PROGRESS = ['INSPECTION', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'WORKSHOP_TRANSFER', 'WORKSHOP_REPAIR', 'QUALITY_CHECK', 'READY_FOR_HANDOVER'];
const GROUPS = {
  available: { assignment: ['OFFERED'], job: ['ASSIGNED'] },
  assigned: { assignment: ['OFFERED', 'ACCEPTED'], jobNotIn: ['COMPLETED', 'CANCELLED'] },
  accepted: { assignment: ['ACCEPTED'], job: ['ACCEPTED'] },
  upcoming: { assignment: ['ACCEPTED'], job: ['APPOINTMENT_CONFIRMED', 'TECHNICIAN_EN_ROUTE'] },
  progress: { assignment: ['ACCEPTED'], job: IN_PROGRESS },
  completed: { assignment: ['COMPLETED'], job: ['COMPLETED'] },
  cancelled: { assignment: ['WITHDRAWN', 'COMPLETED', 'ACCEPTED'], job: ['CANCELLED'] },
};
const whereFor = (technicianId, g) => ({ technicianId, status: { in: g.assignment }, job: g.jobNotIn ? { status: { notIn: g.jobNotIn } } : { status: { in: g.job } } });

router.get('/technicians/me/dashboard', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const keys = Object.keys(GROUPS);
  const [counts, settlements] = await Promise.all([
    Promise.all(keys.map((k) => prisma.jobAssignment.count({ where: whereFor(t.id, GROUPS[k]) }))),
    prisma.technicianSettlement.groupBy({ by: ['settlementStatus'], where: { technicianId: t.id }, _sum: { technicianAmount: true }, _count: { _all: true } }),
  ]);
  const sum = (status) => Number(settlements.find((s) => s.settlementStatus === status)?._sum.technicianAmount ?? 0);
  ok(res, {
    counts: Object.fromEntries(keys.map((k, i) => [k, counts[i]])),
    earnings: { pending: sum('PENDING'), approved: sum('APPROVED'), paid: sum('PAID') },
  });
}));

// Customer contact details and the exact address are revealed only after the technician accepts.
router.get('/technicians/me/jobs', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const group = GROUPS[req.query.group] ? req.query.group : 'assigned';
  const assignments = await prisma.jobAssignment.findMany({
    where: whereFor(t.id, GROUPS[group]), orderBy: { assignedAt: 'desc' }, take: 100,
    include: {
      job: {
        include: {
          booking: { include: { service: { select: { name: true, diagnosticFee: true, category: { select: { name: true } } } }, device: true, address: true, customer: { select: { user: { select: { fullName: true, phone: true } } } } } },
          inspections: { orderBy: { createdAt: 'desc' }, take: 1 },
          quotations: { orderBy: { version: 'desc' }, take: 1, select: { id: true, status: true, total: true, version: true, revisionNote: true, resumeStatus: true } },
          serviceReports: { take: 1, select: { id: true } },
        },
      },
    },
  });
  ok(res, assignments.map((a) => {
    const { booking, inspections, quotations, serviceReports, ...job } = a.job;
    const revealed = ['ACCEPTED', 'COMPLETED'].includes(a.status);
    return {
      assignmentId: a.id, assignmentStatus: a.status, assignedAt: a.assignedAt,
      job: { id: job.id, reference: job.reference, status: job.status, scheduledFor: job.scheduledFor, scheduledWindow: job.scheduledWindow, atWorkshop: !!job.assignedWorkshopId },
      inspection: inspections[0] ?? null, quotation: quotations[0] ?? null, hasServiceReport: serviceReports.length > 0,
      booking: {
        id: booking.id, reference: booking.reference, fulfilmentMethod: booking.fulfilmentMethod, faultDescription: booking.faultDescription,
        preferredDate: booking.preferredDate, preferredTime: booking.preferredTime, service: booking.service, device: booking.device,
        address: revealed ? booking.address : { district: booking.address.district, town: booking.address.town, area: booking.address.area },
        customer: revealed ? { fullName: booking.contactName || booking.customer.user.fullName, phone: booking.contactPhone || booking.customer.user.phone } : null,
      },
    };
  }));
}));

// Earnings are calculated by the system from verified jobs. Technicians can only read them (requirements 5.7).
router.get('/technicians/me/earnings', ...asTechnician, asyncHandler(async (req, res) => {
  const t = await currentTechnician(req);
  const rows = await prisma.technicianSettlement.findMany({ where: { technicianId: t.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  const jobs = await prisma.job.findMany({ where: { id: { in: rows.map((r) => r.jobId) } }, select: { id: true, reference: true, booking: { select: { reference: true, service: { select: { name: true } } } } } });
  const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
  ok(res, rows.map((r) => ({
    id: r.id, jobReference: byId[r.jobId]?.reference ?? null, bookingReference: byId[r.jobId]?.booking.reference, service: byId[r.jobId]?.booking.service.name,
    labourAmount: Number(r.eligibleLabourAmount), commissionRate: Number(r.commissionRate), technicianAmount: Number(r.technicianAmount),
    deductions: Number(r.deductions), status: r.settlementStatus, paymentReference: r.paymentReference, settledAt: r.settledAt, createdAt: r.createdAt,
  })));
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
    await notify(tx, booking.customer.userId, 'Technician confirmed', `A technician has accepted your booking ${booking.reference}. Open your dashboard to see who is coming.`, 'TECHNICIAN_ASSIGNED');
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
    await notifyOps(tx, 'Job offer declined', `${assignment.job.reference || 'A job'} was declined: ${reason}. It is back in the dispatch queue.`, 'OFFER_DECLINED');
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

// Full application view. The NIN stays masked here; revealing it is a separate audited action.
router.get('/admin/technicians/:id', ...ops, asyncHandler(async (req, res) => {
  const t = await prisma.technician.findUnique({
    where: { id: req.params.id },
    select: {
      ...SAFE_TECHNICIAN,
      user: { select: { id: true, fullName: true, phone: true, email: true, status: true, createdAt: true, lastLoginAt: true, phoneVerifiedAt: true, emailVerifiedAt: true } },
      coverageAreas: { select: { district: true, town: true, active: true } },
      specialisations: { select: { service: { select: { id: true, name: true, category: { select: { name: true } } } } } },
      documents: { select: { id: true, documentType: true, label: true, verificationStatus: true, createdAt: true } },
      referees: { select: { name: true, phone: true, relationship: true } },
    },
  });
  if (!t) throw new ApiError(404, 'Technician not found');
  const [work, history, ratings] = await Promise.all([
    prisma.jobAssignment.groupBy({ by: ['status'], where: { technicianId: t.id }, _count: { _all: true } }),
    prisma.auditLog.findMany({ where: { entityType: 'Technician', entityId: t.id }, orderBy: { createdAt: 'asc' }, select: { action: true, newValues: true, userId: true, createdAt: true } }),
    prisma.review.aggregate({ where: { technicianId: t.id }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const actorIds = [...new Set(history.map((h) => h.userId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }) : [];
  const names = Object.fromEntries(actors.map((a) => [a.id, a.fullName]));
  ok(res, {
    ...t,
    work: Object.fromEntries(work.map((g) => [g.status, g._count._all])),
    rating: { average: ratings._avg.rating ? Math.round(ratings._avg.rating * 10) / 10 : null, count: ratings._count._all },
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
        fullName: b.fullName, phone: b.phone, email: b.email, status: 'ACTIVE', passwordHash: await bcrypt.hash(b.password, 12),
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
  ok(res, user, 'Technician created and awaiting review', 201);
}));

// Verification workflow (requirements 5.2): pending, under review, additional information required, approved, rejected, suspended, deactivated.
const STATUS_TEXT = {
  UNDER_REVIEW: ['Your application is being reviewed', 'FixPro has started reviewing your application.'],
  ADDITIONAL_INFO_REQUIRED: ['We need more information', 'Open your dashboard to see what we need, then send it back.'],
  VERIFIED: ['You are approved', 'Your account is approved. Go available to start receiving jobs.'],
  REJECTED: ['Application update', 'Your application was not approved.'],
  SUSPENDED: ['Your account is suspended', 'You will not receive jobs while it is suspended.'],
  DEACTIVATED: ['Your account is deactivated', 'You will not receive jobs. Contact FixPro support if this is a mistake.'],
};

router.patch('/admin/technicians/:id/verify', ...ops, asyncHandler(async (req, res) => {
  const { status, note } = z.object({ status: z.enum(Object.keys(STATUS_TEXT)), note: z.string().trim().max(500).optional() }).parse(req.body);
  if (['ADDITIONAL_INFO_REQUIRED', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'].includes(status) && !note) {
    throw new ApiError(422, 'Validation failed', [{ field: 'note', message: 'Give the technician a reason' }]);
  }
  const before = await prisma.technician.findUnique({ where: { id: req.params.id }, select: { verificationStatus: true, photoUrl: true, ninHash: true, _count: { select: { documents: true } } } });
  if (!before) throw new ApiError(404, 'Technician not found');
  if (status === 'VERIFIED') {
    const missing = [!before.ninHash && 'National ID number', !before.photoUrl && 'profile photo', !before._count.documents && 'ID document'].filter(Boolean);
    if (missing.length) throw new ApiError(422, `Cannot approve yet. Missing: ${missing.join(', ')}.`);
  }
  const technician = await prisma.$transaction(async (tx) => {
    const updated = await tx.technician.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: status,
        ...(!['VERIFIED', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED'].includes(status) && { available: false }),
        infoRequestNote: ['ADDITIONAL_INFO_REQUIRED', 'REJECTED'].includes(status) ? note : status === 'VERIFIED' ? null : undefined,
      },
      select: { id: true, userId: true, verificationStatus: true, available: true },
    });
    if (status === 'VERIFIED') await tx.technicianDocument.updateMany({ where: { technicianId: updated.id }, data: { verificationStatus: 'VERIFIED' } });
    const [title, text] = STATUS_TEXT[status];
    await notify(tx, updated.userId, title, `${text}${note ? ` ${note}` : ''}`, 'TECHNICIAN_VERIFICATION');
    await audit(tx, { userId: req.user.id, action: 'TECHNICIAN_VERIFICATION', entityType: 'Technician', entityId: updated.id, previousValues: { verificationStatus: before.verificationStatus }, newValues: { verificationStatus: status, ...(note && { note }) }, ip: req.ip });
    return updated;
  });
  ok(res, technician, 'Status updated');
}));

export default router;
