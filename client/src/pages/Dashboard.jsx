import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import Stepper from '../components/Stepper.jsx';
import Updates from '../components/Updates.jsx';
import { Icon } from '../components/Art.jsx';
import { Reveal } from '../lib/motion.jsx';
import { FRIENDLY, formatDate, stageOf, ugx, windowLabel } from '../lib/format.js';

const CANCELLABLE = ['NEW_REQUEST', 'UNDER_REVIEW', 'AWAITING_ASSIGNMENT', 'TECHNICIAN_ASSIGNED', 'ACCEPTED', 'APPOINTMENT_CONFIRMED'];
const TABS = [['', 'All', 'total'], ['pending', 'Pending', 'pending'], ['active', 'Accepted and active', 'active'], ['completed', 'Completed', 'completed'], ['cancelled', 'Cancelled', 'cancelled']];

function BookingCard({ b, onCancel }) {
  const status = b.job?.status || b.status;
  const stage = stageOf(b.job?.status, b.status);
  const needsAction = b.quotation?.status === 'SENT' && b.job?.status === 'AWAITING_APPROVAL';
  const due = b.invoice && Number(b.invoice.balance) > 0;
  return (
    <li className={`glass rounded-3xl p-6 ${needsAction ? 'ring-1 ring-lime/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold tracking-tight">{b.service.name}</p>
          <p className="mt-1 text-sm text-mist">{[b.device.brand, b.device.model, b.device.category].filter(Boolean).join(' ')} · {b.reference} · requested {formatDate(b.createdAt)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stage < 0 ? 'bg-danger/15 text-danger' : stage >= 6 ? 'bg-lime/15 text-accent' : 'bg-white/10'}`}>{FRIENDLY[status] || status}</span>
      </div>

      {stage >= 0 && <div className="mt-6"><Stepper stage={stage} /></div>}
      {needsAction && <p className="mt-5 rounded-2xl bg-lime/10 px-4 py-3 text-sm"><span className="font-semibold">Action needed:</span> your quotation of {ugx(b.quotation.total)} is ready to review.</p>}

      <div className="mt-6 grid gap-5 border-t border-white/10 pt-5 md:grid-cols-3">
        <div className="flex items-center gap-3">
          {b.technician ? (
            <>
              <Avatar name={b.technician.fullName} src={b.technician.photoUrl} className="h-12 w-12" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{b.technician.fullName}{b.technician.verified && <span className="ml-2 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-semibold text-accent">Verified</span>}</p>
                <a href={`tel:${b.technician.phone}`} className="text-sm text-mist hover:text-white">{b.technician.phone}</a>
              </div>
            </>
          ) : (
            <p className="text-sm text-mist">{b.awaitingTechnician ? 'A technician is assigned and will confirm shortly.' : stage < 0 ? 'No technician was assigned.' : 'Your technician will appear here once confirmed.'}</p>
          )}
        </div>
        <div className="text-sm">
          <p className="text-mist">{b.job?.scheduledFor ? 'Appointment' : 'Requested time'}</p>
          <p className="mt-0.5 font-semibold">
            {b.job?.scheduledFor ? `${formatDate(b.job.scheduledFor)}, ${windowLabel(b.job.scheduledWindow)}` : b.preferredDate ? `${formatDate(b.preferredDate)}${b.preferredTime ? `, ${windowLabel(b.preferredTime)}` : ''}` : 'Any time'}
          </p>
        </div>
        <div className="text-sm">
          <p className="text-mist">{b.invoice ? 'Invoice' : b.quotation ? 'Quotation' : 'Cost'}</p>
          {b.invoice ? (
            <p className="mt-0.5 font-semibold">{ugx(b.invoice.total)} <span className="font-normal text-mist">· {due ? `${ugx(b.invoice.balance)} due` : 'paid in full'}</span></p>
          ) : b.quotation ? (
            <p className="mt-0.5 font-semibold">{ugx(b.quotation.total)}</p>
          ) : (
            <p className="mt-0.5 text-mist">Quoted after inspection</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link to={`/bookings/${b.id}`} className={needsAction ? 'btn-primary' : 'btn-ghost'}>{needsAction ? 'Review quotation' : 'View details'}</Link>
        {CANCELLABLE.includes(b.status) && <button className="btn-ghost" onClick={() => onCancel(b)}>Cancel request</button>}
      </div>
    </li>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [group, setGroup] = useState('');
  const [summary, setSummary] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api('/customers/me/summary').then(({ data }) => setSummary(data)).catch((e) => setError(e.message));
    api(`/bookings?limit=50${group ? `&group=${group}` : ''}`).then(({ data }) => setBookings(data)).catch((e) => setError(e.message));
  }, [group]);
  useEffect(load, [load]);

  const cancel = async (b) => {
    if (!window.confirm(`Cancel request ${b.reference}?`)) return;
    try { await api(`/bookings/${b.id}/cancel`, { method: 'POST', body: {} }); load(); } catch (e) { setError(e.message); }
  };

  const cards = summary && [
    ['Requests', summary.total], ['Pending', summary.pending], ['Active', summary.active], ['Completed', summary.completed],
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-14 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="giant-md">Hello, {user.fullName.split(' ')[0]}</h1>
        <Link to="/book" className="btn-primary !px-7 !py-3.5">Book a repair</Link>
      </div>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}

      {summary && (
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {cards.map(([label, value], i) => (
            <Reveal key={label} delay={i * 60} className="glass rounded-3xl p-5 lg:col-span-1">
              <p className="text-sm text-mist">{label}</p>
              <p className="mt-1 font-display text-4xl font-extrabold tracking-tighter">{value}</p>
            </Reveal>
          ))}
          <Reveal delay={240} className="glass rounded-3xl p-5 lg:col-span-1">
            <p className="text-sm text-mist">Total spent</p>
            <p className="mt-2 font-display text-xl font-extrabold tracking-tight">{ugx(summary.totalSpent)}</p>
          </Reveal>
          <Reveal delay={300} className="glass rounded-3xl p-5 lg:col-span-1">
            <p className="text-sm text-mist">Still to pay</p>
            <p className="mt-2 font-display text-xl font-extrabold tracking-tight">{ugx(summary.outstanding)}</p>
          </Reveal>
        </div>
      )}

      <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div>
          <div role="tablist" aria-label="Filter requests" className="scrollbar-none flex gap-2 overflow-x-auto">
            {TABS.map(([value, label, key]) => (
              <button key={label} role="tab" aria-selected={group === value} onClick={() => setGroup(value)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${group === value ? 'bg-paper text-navy-950' : 'glass text-mist hover:text-white'}`}>
                {label}{summary ? <span className="ml-2 opacity-60">{summary[key]}</span> : ''}
              </button>
            ))}
          </div>

          {!bookings && !error && <p className="mt-8 text-mist">Loading…</p>}
          {bookings && !bookings.length && (
            <div className="glass mt-6 rounded-3xl p-10 text-center">
              <p className="font-display text-2xl font-bold">Nothing here yet</p>
              <p className="mt-2 text-mist">{group ? 'No requests in this tab.' : 'Book your first repair and follow it here.'}</p>
              <Link to="/book" className="btn-primary mt-6">Book a repair</Link>
            </div>
          )}
          <ul key={group} className="mt-6 space-y-4">
            {bookings?.map((b, i) => <Reveal as="div" key={b.id} delay={i * 50}><BookingCard b={b} onCancel={cancel} /></Reveal>)}
          </ul>
        </div>
        <aside className="space-y-4"><Updates /></aside>
      </div>
    </section>
  );
}
