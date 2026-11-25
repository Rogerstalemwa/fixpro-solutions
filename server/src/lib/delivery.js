import nodemailer from 'nodemailer';
import { prisma } from './prisma.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { notify } from './workflow.js';

let transporter;
const smtp = () => {
  if (!process.env.SMTP_HOST) return null;
  transporter ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
};

// Sends one message. Without a configured provider the message is written to the server log (handy in development).
export async function sendMessage({ channel, to, subject, text }) {
  if (channel === 'EMAIL') {
    const t = smtp();
    if (!t) { logger.info({ to, subject, text }, 'EMAIL not sent: no SMTP configured'); return { provider: 'console' }; }
    await t.sendMail({ from: process.env.SMTP_FROM || 'FixPro <no-reply@fixpro.local>', to, subject, text });
    return { provider: 'smtp' };
  }
  if (channel === 'SMS') {
    if (!process.env.AT_API_KEY || !process.env.AT_USERNAME) { logger.info({ to, text }, 'SMS not sent: no SMS provider configured'); return { provider: 'console' }; }
    const host = process.env.AT_USERNAME === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    const body = new URLSearchParams({ username: process.env.AT_USERNAME, to, message: text, ...(process.env.AT_SENDER_ID && { from: process.env.AT_SENDER_ID }) });
    const res = await fetch(`https://${host}/version1/messaging`, {
      method: 'POST', headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    if (!res.ok) throw new Error(`SMS provider error ${res.status}`);
    return { provider: 'africastalking' };
  }
  throw new Error(`Unknown channel ${channel}`);
}

// Outbox: notifications are saved with the business change, then sent here so a slow provider never blocks a request.
export async function dispatchPending() {
  const rows = await prisma.notification.findMany({
    where: { deliveryChannel: { in: ['SMS', 'EMAIL'] }, deliveryStatus: 'PENDING' },
    orderBy: { createdAt: 'asc' }, take: 20,
    include: { user: { select: { phone: true, email: true } } },
  });
  for (const n of rows) {
    const to = n.deliveryChannel === 'SMS' ? n.user.phone : n.user.email;
    let status = 'SENT';
    if (!to) status = 'FAILED';
    else {
      try { await sendMessage({ channel: n.deliveryChannel, to, subject: n.title, text: `${n.title}: ${n.message}` }); }
      catch (err) { logger.warn({ err: err.message, id: n.id }, 'Notification delivery failed'); status = 'FAILED'; }
    }
    await prisma.notification.update({ where: { id: n.id }, data: { deliveryStatus: status } });
  }
}

// Requirements 5.5: tell administrators when a job offer has not been answered.
export async function remindUnacceptedOffers() {
  const cutoff = new Date(Date.now() - config.offerTimeoutMinutes * 60_000);
  const stale = await prisma.jobAssignment.findMany({
    where: { status: 'OFFERED', reminderSentAt: null, assignedAt: { lt: cutoff }, job: { status: 'ASSIGNED' } },
    take: 50,
    include: { job: { select: { reference: true, booking: { select: { reference: true } } } }, technician: { select: { user: { select: { fullName: true } } } } },
  });
  if (!stale.length) return;
  const staff = await prisma.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { name: { in: ['OPERATIONS_ADMIN', 'SUPER_ADMIN'] } } } } }, select: { id: true } });
  for (const a of stale) {
    await prisma.$transaction(async (tx) => {
      for (const u of staff) {
        await notify(tx, u.id, 'Job offer not accepted', `${a.technician.user.fullName} has not answered the offer for ${a.job.reference || a.job.booking.reference}. Consider reassigning it.`, 'OFFER_UNACCEPTED');
      }
      await tx.jobAssignment.update({ where: { id: a.id }, data: { reminderSentAt: new Date() } });
    });
  }
}

export function startBackgroundJobs() {
  const run = (fn, name) => () => fn().catch((err) => logger.error({ err: err.message }, `${name} failed`));
  setInterval(run(dispatchPending, 'Notification dispatch'), 15_000).unref();
  setInterval(run(remindUnacceptedOffers, 'Offer reminder'), 5 * 60_000).unref();
}
