import { ApiError } from './http.js';

// Job and booking status rules shared by dispatch, technician and job modules.
export const BOOKING_FOR_JOB = {
  CREATED: 'AWAITING_ASSIGNMENT', AWAITING_ASSIGNMENT: 'AWAITING_ASSIGNMENT', ASSIGNED: 'TECHNICIAN_ASSIGNED',
  ACCEPTED: 'ACCEPTED', APPOINTMENT_CONFIRMED: 'APPOINTMENT_CONFIRMED', TECHNICIAN_EN_ROUTE: 'IN_PROGRESS',
  INSPECTION: 'IN_PROGRESS', AWAITING_APPROVAL: 'AWAITING_APPROVAL', APPROVED: 'IN_PROGRESS', IN_PROGRESS: 'IN_PROGRESS',
  WORKSHOP_TRANSFER: 'IN_PROGRESS', WORKSHOP_REPAIR: 'IN_PROGRESS', QUALITY_CHECK: 'IN_PROGRESS',
  READY_FOR_HANDOVER: 'IN_PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', DISPUTED: 'DISPUTED',
};

// Moves a technician may request themselves. Quotation approval, payment and handover
// (AWAITING_APPROVAL, APPROVED, COMPLETED) belong to later modules and are never set from here.
export const TECHNICIAN_TRANSITIONS = {
  ACCEPTED: ['APPOINTMENT_CONFIRMED', 'TECHNICIAN_EN_ROUTE'],
  APPOINTMENT_CONFIRMED: ['TECHNICIAN_EN_ROUTE'],
  TECHNICIAN_EN_ROUTE: ['INSPECTION'],
  APPROVED: ['IN_PROGRESS'],
  IN_PROGRESS: ['QUALITY_CHECK'],
  QUALITY_CHECK: ['READY_FOR_HANDOVER'],
};

// Workshop repairs: the technician starts and finishes the bench work. Leaving QUALITY_CHECK is only possible
// through the workshop quality inspection, and release is only possible through the workshop release.
export const WORKSHOP_TRANSITIONS = {
  APPROVED: ['WORKSHOP_REPAIR'],
  WORKSHOP_REPAIR: ['QUALITY_CHECK'],
};

export const ACTIVE_ASSIGNMENT = ['OFFERED', 'ACCEPTED'];
export const FINAL_JOB = ['COMPLETED', 'CANCELLED'];

// Updates the job, keeps the booking status in step, and records history. Call inside a transaction.
export async function moveJob(tx, { job, to, userId, notes }) {
  const moved = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data: { status: to } });
  if (!moved.count) {
    throw new ApiError(409, 'This job was changed by someone else. Refresh and try again.');
  }
  await tx.booking.update({ where: { id: job.bookingId }, data: { status: BOOKING_FOR_JOB[to] } });
  await tx.jobStatusHistory.create({
    data: { jobId: job.id, previousStatus: job.status, newStatus: to, changedById: userId, notes },
  });
}

// Always saves an in-app notification. If the person prefers SMS or email, a second row is queued for the delivery worker.
export async function notify(tx, userId, title, message, notificationType) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { preferredContact: true, email: true } });
  const rows = [{ userId, title, message, notificationType, deliveryChannel: 'IN_APP', deliveryStatus: 'DELIVERED' }];
  const pref = user?.preferredContact;
  if (pref === 'SMS' || (pref === 'EMAIL' && user.email)) {
    rows.push({ userId, title, message, notificationType, deliveryChannel: pref === 'EMAIL' ? 'EMAIL' : 'SMS', deliveryStatus: 'PENDING' });
  }
  await tx.notification.createMany({ data: rows });
}

export async function notifyOps(tx, title, message, notificationType) {
  const staff = await tx.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { name: { in: ['OPERATIONS_ADMIN', 'SUPER_ADMIN'] } } } } }, select: { id: true } });
  for (const u of staff) await notify(tx, u.id, title, message, notificationType);
}
