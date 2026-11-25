export const statusLabel = (s = '') => {
  const t = s.replaceAll('_', ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const ugx = (n) => (n == null ? '' : `UGX ${Number(n).toLocaleString('en-UG')}`);

export const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' });

export const statusTone = (s) =>
  s === 'COMPLETED' ? 'bg-lime/15 text-accent'
  : s === 'CANCELLED' || s === 'DISPUTED' ? 'bg-danger/15 text-danger'
  : 'bg-navy-700 text-paper';

export const formatDateTime = (d) =>
  new Date(d).toLocaleString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' });

export const windowLabel = (w) => (w ? w.replace('-', ' to ') : '');

// Plain-language status for customers.
export const FRIENDLY = {
  NEW_REQUEST: 'Request received', UNDER_REVIEW: 'Being reviewed', AWAITING_ASSIGNMENT: 'Finding you a technician',
  CREATED: 'Request received', ASSIGNED: 'Waiting for the technician to confirm', ACCEPTED: 'Technician confirmed. Appointment to be set',
  APPOINTMENT_CONFIRMED: 'Appointment confirmed', TECHNICIAN_EN_ROUTE: 'Technician is on the way', INSPECTION: 'Inspecting your device',
  AWAITING_APPROVAL: 'Quotation is waiting for your approval', APPROVED: 'Repair approved. Starting soon', IN_PROGRESS: 'Repair in progress',
  WORKSHOP_TRANSFER: 'Device is moving to the workshop', WORKSHOP_REPAIR: 'Being repaired in the workshop', QUALITY_CHECK: 'Final quality check',
  READY_FOR_HANDOVER: 'Ready for handover. Payment due', COMPLETED: 'Completed', CANCELLED: 'Cancelled', DISPUTED: 'Under review',
  TECHNICIAN_ASSIGNED: 'Waiting for the technician to confirm',
};

export const STAGES = ['Requested', 'Technician', 'Appointment', 'Inspection and quote', 'Repair', 'Payment and handover'];

// Index of the stage in progress; STAGES.length means everything is done; -1 means cancelled.
export const stageOf = (jobStatus, bookingStatus) => {
  const s = jobStatus || bookingStatus;
  if (['CANCELLED', 'DISPUTED'].includes(s)) return -1;
  if (s === 'COMPLETED') return STAGES.length;
  if (['ASSIGNED', 'TECHNICIAN_ASSIGNED'].includes(s)) return 1;
  if (s === 'ACCEPTED') return 2;
  if (['APPOINTMENT_CONFIRMED', 'TECHNICIAN_EN_ROUTE', 'INSPECTION', 'AWAITING_APPROVAL'].includes(s)) return 3;
  if (['APPROVED', 'IN_PROGRESS', 'WORKSHOP_TRANSFER', 'WORKSHOP_REPAIR', 'QUALITY_CHECK'].includes(s)) return 4;
  if (s === 'READY_FOR_HANDOVER') return 5;
  return 0;
};

export const STATUS_STYLE = {
  VERIFIED: 'bg-lime/15 text-accent', PENDING_REVIEW: 'bg-white/10', NOT_SUBMITTED: 'bg-white/10',
  REJECTED: 'bg-danger/15 text-danger', SUSPENDED: 'bg-danger/15 text-danger', EXPIRED: 'bg-danger/15 text-danger',
  DEACTIVATED: 'bg-danger/15 text-danger', UNDER_REVIEW: 'bg-white/10 ring-1 ring-accent/40', ADDITIONAL_INFO_REQUIRED: 'bg-white/10 ring-1 ring-accent/40',
};

// A new job starts as CREATED while operations review the request, so show the booking status until the job moves on.
export const displayStatus = (jobStatus, bookingStatus) => (!jobStatus || jobStatus === 'CREATED' ? bookingStatus : jobStatus);

export const VERIFY_LABEL = {
  NOT_SUBMITTED: 'Not submitted', PENDING_REVIEW: 'Pending', UNDER_REVIEW: 'Under review', ADDITIONAL_INFO_REQUIRED: 'More information needed',
  VERIFIED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated', EXPIRED: 'Expired',
};
