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

// Eligible technicians: verified, active, available, covering the job's district and trained for the service.
// Ordered by town match, then lightest workload.
export async function findCandidates(job) {
  const { address, serviceId } = job.booking;
  const technicians = await prisma.technician.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      available: true,
      user: { status: 'ACTIVE' },
      coverageAreas: { some: { active: true, district: { equals: address.district, mode: 'insensitive' } } },
      specialisations: { some: { serviceId } },
    },
    include: {
      user: { select: { fullName: true, phone: true } },
      coverageAreas: { where: { active: true } },
      _count: { select: { assignments: { where: { status: { in: ACTIVE_ASSIGNMENT }, job: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } } } } },
    },
  });
  return technicians
    .map((t) => ({
      id: t.id,
      userId: t.userId,
      fullName: t.user.fullName,
      phone: t.user.phone,
      technicianType: t.technicianType,
      activeJobs: t._count.assignments,
      townMatch: !!address.town && t.coverageAreas.some((c) => c.town?.toLowerCase() === address.town.toLowerCase()),
    }))
    .sort((a, b) => Number(b.townMatch) - Number(a.townMatch) || a.activeJobs - b.activeJobs);
}

const loadJob = async (id) => {
  const job = await prisma.job.findUnique({ where: { id }, include: JOB_CONTEXT });
  if (!job) throw new ApiError(404, 'Job not found');
  return job;
};

router.get(
  '/dispatch/queue',
  asyncHandler(async (_req, res) => {
    const jobs = await prisma.job.findMany({
      where: { status: 'AWAITING_ASSIGNMENT' },
      include: JOB_CONTEXT,
      orderBy: { createdAt: 'asc' }, // oldest request first
    });
    ok(res, jobs.map(({ booking: { customer, ...booking }, ...job }) => ({ ...job, booking })));
  })
);

router.get(
  '/dispatch/candidates/:jobId',
  asyncHandler(async (req, res) => {
    const job = await loadJob(req.params.jobId);
    ok(res, (await findCandidates(job)).map(({ userId, ...c }) => c));
  })
);

const assignSchema = z.object({ technicianId: z.string().uuid(), reason: z.string().trim().min(3).max(500).optional(), notes: z.string().trim().max(500).optional() });

async function offerJob(req, res, { reassign }) {
  const body = assignSchema.parse(req.body);
  if (reassign && !body.reason) throw new ApiError(422, 'Give a reason for reassigning this job', [{ field: 'reason', message: 'Reason is required' }]);
  const job = await loadJob(req.params.id);
  const allowed = reassign ? ['ASSIGNED', 'ACCEPTED', 'APPOINTMENT_CONFIRMED'] : ['AWAITING_ASSIGNMENT'];
  if (!allowed.includes(job.status)) throw new ApiError(409, reassign ? 'Only an assigned job can be reassigned' : 'This job is not waiting for assignment');

  const technician = (await findCandidates(job)).find((c) => c.id === body.technicianId);
  if (!technician) throw new ApiError(422, 'That technician is not eligible for this job (check verification, availability, area and skills).');

  await prisma.$transaction(async (tx) => {
    const previous = await tx.jobAssignment.findMany({ where: { jobId: job.id, status: { in: ACTIVE_ASSIGNMENT } } });
    if (reassign && previous.some((p) => p.technicianId === technician.id)) throw new ApiError(409, 'That technician already holds this job');
    if (previous.length) await tx.jobAssignment.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: 'WITHDRAWN' } });
    await tx.jobAssignment.create({ data: { jobId: job.id, technicianId: technician.id, assignedById: req.user.id } });
    await moveJob(tx, { job, to: 'ASSIGNED', userId: req.user.id, notes: reassign ? `Reassigned: ${body.reason}` : body.notes ?? 'Technician assigned' });
    await notify(tx, technician.userId, 'New job offered', `Job ${job.booking.reference} (${job.booking.service.name}) in ${job.booking.address.district} is waiting for your response.`, 'JOB_OFFERED');
    await audit(tx, {
      userId: req.user.id, action: reassign ? 'JOB_REASSIGNED' : 'JOB_ASSIGNED', entityType: 'Job', entityId: job.id,
      previousValues: previous.length ? { technicianIds: previous.map((p) => p.technicianId) } : undefined,
      newValues: { technicianId: technician.id }, ip: req.ip,
    });
  });
  ok(res, { jobId: job.id, status: 'ASSIGNED', technician: { id: technician.id, fullName: technician.fullName } }, reassign ? 'Job reassigned' : 'Job offered to technician');
}

router.post('/jobs/:id/assign', asyncHandler((req, res) => offerJob(req, res, { reassign: false })));
router.post('/jobs/:id/reassign', asyncHandler((req, res) => offerJob(req, res, { reassign: true })));

export default router;
