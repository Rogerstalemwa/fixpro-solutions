import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { ACTIVE_ASSIGNMENT, moveJob, notify } from '../../lib/workflow.js';
import { authenticate, requireRole } from '../../middleware/auth.js';

// Mounted at /admin
const router = Router();
router.use(authenticate, requireRole('OPERATIONS_ADMIN'));

export const REASSIGN_REASONS = {
  TECHNICIAN_DECLINED: 'The technician declined',
  TECHNICIAN_UNAVAILABLE: 'The technician became unavailable',
  TECHNICIAN_NO_SHOW: 'The technician did not attend',
  DIFFERENT_SPECIALISATION: 'The job needs a different specialisation',
  CUSTOMER_REQUEST: 'The customer asked for a change',
  OTHER: 'Other reason',
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const kampalaDay = (d) => new Date(new Date(d).getTime() + 3 * 3_600_000).getUTCDay();

const JOB_CONTEXT = {
  booking: {
    include: {
      service: { select: { name: true, category: { select: { name: true } } } },
      device: { select: { category: true, brand: true, model: true } },
      address: { select: { district: true, town: true, area: true } },
      customer: { select: { userId: true } },
    },
  },
};

// Matching (requirements 6.2): specialisation, location, availability, experience, status, customer rating and past performance.
// Eligible technicians are scored so the best match is first. Administrators can always pick someone else.
export async function findCandidates(job) {
  const { address, serviceId, preferredDate } = job.booking;
  const now = new Date();
  const technicians = await prisma.technician.findMany({
    where: {
      verificationStatus: 'VERIFIED', available: true, user: { status: 'ACTIVE' },
      coverageAreas: { some: { active: true, district: { equals: address.district, mode: 'insensitive' } } },
      specialisations: { some: { serviceId } },
    },
    include: {
      user: { select: { fullName: true, phone: true } },
      coverageAreas: { where: { active: true } },
      reviews: { select: { rating: true } },
      _count: { select: { assignments: { where: { status: { in: ACTIVE_ASSIGNMENT }, job: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } } } } },
    },
  });
  const ids = technicians.map((t) => t.id);
  const history = ids.length ? await prisma.jobAssignment.groupBy({ by: ['technicianId', 'status'], where: { technicianId: { in: ids }, status: { in: ['COMPLETED', 'DECLINED'] } }, _count: { _all: true } }) : [];
  const countOf = (id, status) => history.find((h) => h.technicianId === id && h.status === status)?._count._all ?? 0;

  return technicians
    .filter((t) => !(t.unavailableFrom && t.unavailableUntil && t.unavailableFrom <= now && now <= t.unavailableUntil))
    .map((t) => {
      const ratings = t.reviews.map((r) => r.rating);
      const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
      const townMatch = !!address.town && t.coverageAreas.some((c) => c.town?.toLowerCase() === address.town.toLowerCase());
      const completedJobs = countOf(t.id, 'COMPLETED');
      const declined = countOf(t.id, 'DECLINED');
      const activeJobs = t._count.assignments;
      const warnings = [];
      if (preferredDate && !t.workingDays.includes(kampalaDay(preferredDate))) warnings.push(`Does not usually work on ${DAYS[kampalaDay(preferredDate)]}s`);
      const score = (townMatch ? 20 : 0) + Math.min(t.yearsOfExperience ?? 0, 10) * 2 + (rating == null ? 0 : (rating - 3) * 10)
        + Math.min(completedJobs, 10) - activeJobs * 5 - Math.min(declined, 5) * 2 - warnings.length * 15;
      return {
        id: t.id, userId: t.userId, fullName: t.user.fullName, phone: t.user.phone, technicianType: t.technicianType,
        yearsOfExperience: t.yearsOfExperience, rating: rating == null ? null : Math.round(rating * 10) / 10, ratingCount: ratings.length,
        completedJobs, activeJobs, townMatch, warnings, score: Math.round(score),
      };
    })
    .sort((a, b) => b.score - a.score);
}

const loadJob = async (id) => {
  const job = await prisma.job.findUnique({ where: { id }, include: JOB_CONTEXT });
  if (!job) throw new ApiError(404, 'Job not found');
  return job;
};

router.get('/dispatch/queue', asyncHandler(async (_req, res) => {
  const jobs = await prisma.job.findMany({ where: { status: 'AWAITING_ASSIGNMENT' }, include: JOB_CONTEXT, orderBy: { createdAt: 'asc' } });
  ok(res, jobs.map(({ booking: { customer, ...booking }, ...job }) => ({ ...job, booking })));
}));

router.get('/dispatch/candidates/:jobId', asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.jobId);
  ok(res, (await findCandidates(job)).map(({ userId, ...c }) => c));
}));

async function performOffer(req, job, technician, { reassign, reason, notes }) {
  const label = reason ? REASSIGN_REASONS[reason] : null;
  await prisma.$transaction(async (tx) => {
    const previous = await tx.jobAssignment.findMany({ where: { jobId: job.id, status: { in: ACTIVE_ASSIGNMENT } }, include: { technician: { select: { id: true, userId: true } } } });
    if (previous.some((p) => p.technicianId === technician.id)) throw new ApiError(409, 'That technician already holds this job');
    if (previous.length) await tx.jobAssignment.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: 'WITHDRAWN' } });
    await tx.jobAssignment.create({ data: { jobId: job.id, technicianId: technician.id, assignedById: req.user.id } });
    await moveJob(tx, { job, to: 'ASSIGNED', userId: req.user.id, notes: reassign ? `Reassigned: ${label}${notes ? `. ${notes}` : ''}` : notes ?? 'Technician assigned' });
    if (reassign) await tx.job.update({ where: { id: job.id }, data: { scheduledFor: null, scheduledWindow: null } });
    await notify(tx, technician.userId, 'New job offered', `Job ${job.reference || job.booking.reference} (${job.booking.service.name}) in ${job.booking.address.district} is waiting for your response.`, 'JOB_OFFERED');
    if (reassign) {
      // Everyone affected is told (requirements 6.5).
      for (const p of previous) await notify(tx, p.technician.userId, 'Job reassigned', `Job ${job.reference || job.booking.reference} was given to another technician.`, 'JOB_REASSIGNED');
      if (previous.some((p) => p.status === 'ACCEPTED')) await notify(tx, job.booking.customer.userId, 'Your technician has changed', `We have assigned a different technician to booking ${job.booking.reference}. They will confirm shortly.`, 'TECHNICIAN_CHANGED');
    }
    await audit(tx, {
      userId: req.user.id, action: reassign ? 'JOB_REASSIGNED' : 'JOB_ASSIGNED', entityType: 'Job', entityId: job.id,
      previousValues: previous.length ? { technicianIds: previous.map((p) => p.technicianId) } : undefined,
      newValues: { technicianId: technician.id, ...(reason && { reason }) }, ip: req.ip,
    });
  });
}

const assignSchema = z.object({ technicianId: z.string().uuid(), notes: z.string().trim().max(500).optional() });
const reassignSchema = assignSchema.extend({ reason: z.enum(Object.keys(REASSIGN_REASONS)) });

const eligible = async (job, technicianId) => {
  const t = (await findCandidates(job)).find((c) => c.id === technicianId);
  if (!t) throw new ApiError(422, 'That technician is not eligible for this job (check approval, availability, area and skills).');
  return t;
};

router.post('/jobs/:id/assign', asyncHandler(async (req, res) => {
  const body = assignSchema.parse(req.body);
  const job = await loadJob(req.params.id);
  if (job.status !== 'AWAITING_ASSIGNMENT') throw new ApiError(409, 'This job is not waiting for assignment');
  const t = await eligible(job, body.technicianId);
  await performOffer(req, job, t, { notes: body.notes });
  ok(res, { jobId: job.id, status: 'ASSIGNED', technician: { id: t.id, fullName: t.fullName } }, 'Job offered to technician');
}));

// Automatic assignment: offers the job to the best-scoring technician who has no warnings.
router.post('/jobs/:id/auto-assign', asyncHandler(async (req, res) => {
  const job = await loadJob(req.params.id);
  if (job.status !== 'AWAITING_ASSIGNMENT') throw new ApiError(409, 'This job is not waiting for assignment');
  const list = await findCandidates(job);
  const t = list.find((c) => !c.warnings.length) ?? list[0];
  if (!t) throw new ApiError(422, 'No eligible technician is available for this job.');
  await performOffer(req, job, t, { notes: 'Assigned automatically to the best match' });
  ok(res, { jobId: job.id, status: 'ASSIGNED', technician: { id: t.id, fullName: t.fullName } }, 'Job offered to the best match');
}));

router.post('/jobs/:id/reassign', asyncHandler(async (req, res) => {
  const body = reassignSchema.parse(req.body);
  const job = await loadJob(req.params.id);
  if (!['ASSIGNED', 'ACCEPTED', 'APPOINTMENT_CONFIRMED', 'TECHNICIAN_EN_ROUTE'].includes(job.status)) throw new ApiError(409, 'This job can no longer be reassigned.');
  const t = await eligible(job, body.technicianId);
  await performOffer(req, job, t, { reassign: true, reason: body.reason, notes: body.notes });
  ok(res, { jobId: job.id, status: 'ASSIGNED', technician: { id: t.id, fullName: t.fullName } }, 'Job reassigned');
}));

router.get('/dispatch/reasons', (_req, res) => ok(res, REASSIGN_REASONS));

export default router;
