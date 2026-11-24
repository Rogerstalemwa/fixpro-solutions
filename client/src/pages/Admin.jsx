import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Reveal } from '../lib/motion.jsx';
import { Payments, Technicians } from '../components/AdminPanels.jsx';
import { formatDate, statusLabel, statusTone } from '../lib/format.js';

function QueueItem({ job, onDone }) {
  const { booking } = job;
  const [candidates, setCandidates] = useState(null);
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setError('');
    try { setCandidates((await api(`/admin/dispatch/candidates/${job.id}`)).data); } catch (e) { setError(e.message); }
  };
  const offer = async () => {
    setBusy(true); setError('');
    try {
      await api(`/admin/jobs/${job.id}/assign`, { method: 'POST', body: { technicianId: choice } });
      onDone();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <li className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold tracking-tight">{booking.service.name}</p>
          <p className="mt-1 text-sm text-mist">
            {booking.reference} · {[booking.device.brand, booking.device.model, booking.device.category].filter(Boolean).join(' ')} · {[booking.address.area, booking.address.district].filter(Boolean).join(', ')}
            {booking.preferredDate ? ` · wants ${formatDate(booking.preferredDate)} ${booking.preferredTime || ''}` : ''}
          </p>
          <p className="mt-2 max-w-2xl text-sm">{booking.faultDescription}</p>
        </div>
        {!candidates && <button className="btn-primary" onClick={open}>Assign technician</button>}
      </div>
      {candidates && (
        <div className="mt-5 border-t border-white/10 pt-5">
          {!candidates.length ? (
            <p className="text-sm text-mist">No eligible technician. A technician must be verified, available, cover {booking.address.district} and be trained for this service.</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm text-mist">Eligible technicians, best match first</legend>
              {candidates.map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border p-3.5 text-sm ${choice === c.id ? 'border-lime bg-lime/10' : 'border-white/10'}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name={`t-${job.id}`} className="accent-lime" checked={choice === c.id} onChange={() => setChoice(c.id)} />
                    <span><span className="font-semibold">{c.fullName}</span><span className="block text-mist">{c.phone}</span></span>
                  </span>
                  <span className="text-right text-mist">{c.activeJobs} active job{c.activeJobs === 1 ? '' : 's'}{c.townMatch ? ' · same town' : ''}</span>
                </label>
              ))}
              <button className="btn-primary mt-3" disabled={!choice || busy} onClick={offer}>{busy ? 'Offering…' : 'Offer job'}</button>
            </fieldset>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </li>
  );
}

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api('/admin/dashboard'), api('/admin/bookings?limit=25'), api('/admin/dispatch/queue')])
      .then(([s, b, q]) => { setStats(s.data); setBookings(b.data); setQueue(q.data); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const cards = stats && [
    ['Bookings today', stats.bookingsToday],
    ['Awaiting assignment', stats.awaitingAssignment],
    ['Verified technicians', stats.verifiedTechnicians],
    ['Customers', stats.customers],
  ];

  return (
    <section className="mx-auto max-w-7xl px-5 pb-10 pt-16 sm:px-8 sm:pt-24">
      <h1 className="giant-md">Operations</h1>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}
      {cards && (
        <dl className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(([label, value], i) => (
            <Reveal key={label} delay={i * 70} className="glass rounded-3xl p-6">
              <dt className="text-sm text-mist">{label}</dt>
              <dd className="mt-2 font-display text-5xl font-extrabold tracking-tighter">{value}</dd>
            </Reveal>
          ))}
        </dl>
      )}

      <h2 className="mt-20 font-display text-3xl font-bold tracking-tight">Dispatch queue</h2>
      {queue && !queue.length && <p className="mt-4 text-mist">Nothing is waiting for a technician.</p>}
      <ul className="mt-6 space-y-4">{queue?.map((job) => <QueueItem key={job.id} job={job} onDone={load} />)}</ul>

      <Technicians />
      <Payments />

      <h2 className="mt-20 font-display text-3xl font-bold tracking-tight">Latest bookings</h2>
      {bookings && !bookings.length && <p className="mt-4 text-mist">No bookings yet. New requests will appear here.</p>}
      {bookings?.length > 0 && (
        <div className="glass mt-6 overflow-x-auto rounded-3xl">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-white/10 text-mist">
              <tr>{['Reference', 'Customer', 'Service', 'Location', 'Status', 'Received'].map((h) => <th key={h} className="px-5 py-4 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-4 font-medium">{b.reference}</td>
                  <td className="px-5 py-4">{b.customer.user.fullName}<span className="block text-xs text-mist">{b.customer.user.phone}</span></td>
                  <td className="px-5 py-4">{b.service.name}</td>
                  <td className="px-5 py-4">{[b.address.area, b.address.district].filter(Boolean).join(', ')}</td>
                  <td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone(b.status)}`}>{statusLabel(b.status)}</span></td>
                  <td className="px-5 py-4 text-mist">{formatDate(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
