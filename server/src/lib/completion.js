import { newRef, round2 } from './billing.js';
import { moveJob, notify } from './workflow.js';

// Commission rules (requirements 11.4): the most specific active rule wins. Pass-through items are excluded unless configured.
export function pickRule(rules, technicianType, categoryId) {
  const fits = (r) => r.active && (!r.categoryId || r.categoryId === categoryId) && (!r.technicianType || r.technicianType === technicianType);
  const specificity = (r) => (r.categoryId ? 2 : 0) + (r.technicianType ? 1 : 0);
  return rules.filter(fits).sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}

export function calcSettlement(items, rule) {
  const eligibleTypes = rule.includeParts ? ['LABOUR', 'PART'] : ['LABOUR'];
  const eligible = round2(items.filter((i) => eligibleTypes.includes(i.itemType)).reduce((sum, i) => sum + Number(i.totalPrice), 0));
  const technicianAmount = round2(eligible * Number(rule.technicianRate));
  return { eligible, technicianAmount, companyAmount: round2(eligible - technicianAmount) };
}

// Runs inside the transaction that completes a job: starts the warranty (if the service has one) and the technician's settlement.
export async function onJobCompleted(tx, jobId) {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: {
      booking: { select: { customerId: true, reference: true, customer: { select: { userId: true } }, service: { select: { warrantyDays: true, warrantyTerms: true, warrantyExclusions: true, categoryId: true } } } },
      assignments: { where: { status: { in: ['ACCEPTED', 'COMPLETED'] } }, take: 1, include: { technician: { select: { id: true, technicianType: true } } } },
      invoices: { where: { status: { not: 'CANCELLED' } }, take: 1, orderBy: { createdAt: 'desc' }, include: { items: true } },
      serviceReports: { take: 1, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!job) return;
  const { service } = job.booking;
  const report = job.serviceReports[0];

  if (service.warrantyDays > 0 && !(await tx.warranty.findFirst({ where: { jobId } }))) {
    const start = new Date();
    const warranty = await tx.warranty.create({
      data: {
        reference: newRef('WAR'), jobId, customerId: job.booking.customerId, startDate: start,
        endDate: new Date(start.getTime() + service.warrantyDays * 86_400_000),
        warrantyTerms: service.warrantyTerms, exclusions: service.warrantyExclusions,
        repairSummary: report?.workPerformed, partsReplaced: report?.partsReplaced,
      },
    });
    await notify(tx, job.booking.customer.userId, 'Your warranty is active', `Your repair ${job.booking.reference} is covered for ${service.warrantyDays} days (warranty ${warranty.reference}).`, 'WARRANTY_STARTED');
  }

  const assignment = job.assignments[0];
  const invoice = job.invoices[0];
  if (assignment && invoice) {
    const rules = await tx.commissionRule.findMany({ where: { active: true } });
    const rule = pickRule(rules, assignment.technician.technicianType, service.categoryId);
    if (rule) {
      const calc = calcSettlement(invoice.items, rule);
      await tx.technicianSettlement.upsert({
        where: { jobId },
        update: {},
        create: {
          technicianId: assignment.technician.id, jobId, eligibleLabourAmount: calc.eligible, commissionRate: rule.technicianRate,
          technicianAmount: calc.technicianAmount, companyAmount: calc.companyAmount, settlementStatus: 'PENDING',
        },
      });
    }
  }
}

// Closes a job: assignments complete, status moves to COMPLETED, and the warranty and settlement start.
export async function completeJob(tx, job, userId, notes) {
  await tx.jobAssignment.updateMany({ where: { jobId: job.id, status: 'ACCEPTED' }, data: { status: 'COMPLETED' } });
  await moveJob(tx, { job, to: 'COMPLETED', userId, notes });
  await onJobCompleted(tx, job.id);
}
