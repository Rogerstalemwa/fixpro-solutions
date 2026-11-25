import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import Avatar from '../components/Avatar.jsx';
import Stepper from '../components/Stepper.jsx';
import Fulfilment from '../components/Fulfilment.jsx';
import { FRIENDLY, formatDate, formatDateTime, stageOf, ugx, windowLabel } from '../lib/format.js';

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 text-sm"><dt className="text-mist">{label}</dt><dd className="text-right font-medium">{children}</dd></div>
);
const Panel = ({ title, children, className = '' }) => (
  <section className={`glass rounded-3xl p-6 ${className}`}><h2 className="font-display text-xl font-bold tracking-tight">{title}</h2><div className="mt-4">{children}</div></section>
);

function ItemsTable({ items }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="text-mist"><tr><th className="pb-2 font-medium">Item</th><th className="pb-2 text-right font-medium">Qty</th><th className="pb-2 text-right font-medium">Price</th><th className="pb-2 text-right font-medium">Total</th></tr></thead>
        <tbody className="divide-y divide-white/10">
          {items.map((i) => (
            <tr key={i.id}><td className="py-2.5">{i.description}{i.itemType && <span className="ml-2 text-xs text-mist">{i.itemType.toLowerCase()}</span>}</td><td className="py-2.5 text-right">{Number(i.quantity)}</td><td className="py-2.5 text-right">{ugx(i.unitPrice)}</td><td className="py-2.5 text-right font-medium">{ugx(i.totalPrice)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BookingDetail() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('');

  const load = useCallback(() => { api(`/bookings/${id}/overview`).then(({ data }) => setD(data)).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);

  const act = async (path, body) => {
    setBusy(true); setError('');
    try { await api(path, { method: 'POST', body }); setMode(''); setNote(''); load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (error && !d) return <section className="mx-auto max-w-6xl px-5 py-16"><p className="text-danger" role="alert">{error}</p><Link to="/dashboard" className="btn-ghost mt-6">Back to dashboard</Link></section>;
  if (!d) return <p className="mx-auto max-w-6xl px-5 py-16 text-mist">Loading…</p>;

  const { booking: b, job, technician, quotation: q, inspection, serviceReport, invoice, timeline } = d;
  const status = job?.status || b.status;
  const stage = stageOf(job?.status, b.status);
  const canDecide = q?.status === 'SENT' && job?.status === 'AWAITING_APPROVAL';
  const paid = invoice ? Number(invoice.amountPaid) : 0;

  return (
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-12 sm:px-8">
      <Link to="/dashboard" className="text-sm text-mist hover:text-white">← All requests</Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="giant-md max-w-3xl !text-[clamp(2rem,5vw,3.8rem)]">{b.service.name}</h1>
          <p className="mt-3 text-mist">{b.reference} · requested {formatDate(b.createdAt)}</p>
        </div>
        <span className={`rounded-full px-4 py-2 text-sm font-semibold ${stage < 0 ? 'bg-danger/15 text-danger' : stage >= 6 ? 'bg-lime/15 text-accent' : 'bg-white/10'}`}>{FRIENDLY[status] || status}</span>
      </div>
      <div className="glass mt-8 rounded-3xl p-6"><Stepper stage={stage} /></div>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {canDecide && (
            <Panel title="Your quotation is ready" className="ring-1 ring-lime/60">
              <ItemsTable items={q.items} />
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4"><span className="text-mist">Total</span><span className="font-display text-3xl font-extrabold tracking-tight">{ugx(q.total)}</span></div>
              {q.expiresAt && <p className="mt-2 text-xs text-mist">Valid until {formatDate(q.expiresAt)}. Nothing is repaired until you approve.</p>}
              {mode ? (
                <div className="mt-5 space-y-3">
                  <textarea className="input min-h-24" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'revise' ? 'What should the technician change?' : 'Reason (optional)'} />
                  <div className="flex gap-3">
                    <button className="btn-primary" disabled={busy || (mode === 'revise' && note.trim().length < 3)} onClick={() => act(`/quotations/${q.id}/${mode === 'revise' ? 'request-revision' : 'reject'}`, mode === 'revise' ? { note } : { reason: note || undefined })}>{mode === 'revise' ? 'Send request' : 'Decline quotation'}</button>
                    <button className="btn-ghost" onClick={() => setMode('')}>Back</button>
                  </div>
                  {mode === 'decline' && <p className="text-xs text-mist">Declining closes this request. You will only pay the diagnostic fee.</p>}
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap gap-3">
                  <button className="btn-primary" disabled={busy} onClick={() => act(`/quotations/${q.id}/approve`, {})}>Approve and start repair</button>
                  <button className="btn-ghost" onClick={() => setMode('revise')}>Ask for changes</button>
                  <button className="btn-ghost" onClick={() => setMode('decline')}>Decline</button>
                </div>
              )}
            </Panel>
          )}

          {inspection && (
            <Panel title="What the technician found">
              <dl className="divide-y divide-white/10">
                <Row label="You reported">{inspection.reportedSymptoms}</Row>
                <Row label="Findings">{inspection.findings}</Row>
                <Row label="Recommended">{inspection.recommendedAction}</Row>
                {inspection.estimatedWork && <Row label="Estimated work">{inspection.estimatedWork}</Row>}
              </dl>
            </Panel>
          )}

          {q && !canDecide && (
            <Panel title={`Quotation ${q.reference}`}>
              <p className="mb-3 text-sm text-mist">Status: {q.status.replaceAll('_', ' ').toLowerCase()}{q.revisionNote ? ` · ${q.revisionNote}` : ''}</p>
              <ItemsTable items={q.items} />
              <div className="mt-4 flex justify-between border-t border-white/10 pt-4"><span className="text-mist">Total</span><span className="font-semibold">{ugx(q.total)}</span></div>
            </Panel>
          )}

          {serviceReport && (
            <Panel title="Work completed">
              <dl className="divide-y divide-white/10">
                <Row label="Work done">{serviceReport.workPerformed}</Row>
                {serviceReport.partsReplaced && <Row label="Parts replaced">{serviceReport.partsReplaced}</Row>}
                <Row label="Tested">{serviceReport.testResults}</Row>
                {serviceReport.recommendations && <Row label="Advice">{serviceReport.recommendations}</Row>}
              </dl>
            </Panel>
          )}

          {invoice && (
            <Panel title={`Invoice ${invoice.reference}`}>
              <ItemsTable items={invoice.items} />
              <dl className="mt-4 border-t border-white/10 pt-3">
                <Row label="Total">{ugx(invoice.total)}</Row>
                <Row label="Paid">{ugx(paid)}</Row>
                <Row label="Balance">{Number(invoice.balance) > 0 ? <span className="text-accent">{ugx(invoice.balance)}</span> : 'None, paid in full'}</Row>
              </dl>
              {invoice.payments.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-white/10 pt-4 text-sm">
                  {invoice.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-4"><span className="text-mist">{formatDate(p.confirmedAt)} · {p.paymentMethod?.replaceAll('_', ' ').toLowerCase()}{p.providerTransactionId ? ` · ${p.providerTransactionId}` : ''}</span><span className="font-medium">{ugx(p.amount)}</span></li>
                  ))}
                </ul>
              )}
              {Number(invoice.balance) > 0 && <p className="mt-4 text-sm text-mist">Pay your technician or FixPro, and the payment will be recorded here. Online payment is coming soon.</p>}
            </Panel>
          )}

          <Fulfilment bookingId={b.id} Panel={Panel} />

          <Panel title="Timeline">
            {!timeline.length ? <p className="text-sm text-mist">Updates will appear here.</p> : (
              <ol className="space-y-4">
                {[...timeline].reverse().map((t, i) => (
                  <li key={i} className="flex gap-4">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-lime' : 'bg-white/25'}`} />
                    <div><p className="text-sm font-semibold">{FRIENDLY[t.newStatus] || t.newStatus}</p>{t.notes && <p className="text-sm text-mist">{t.notes}</p>}<p className="text-xs text-mist/70">{formatDateTime(t.createdAt)}</p></div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Your technician">
            {technician ? (
              <div>
                <div className="flex items-center gap-4">
                  <Avatar name={technician.fullName} src={technician.photoUrl} className="h-20 w-20" />
                  <div>
                    <p className="font-display text-xl font-bold leading-tight">{technician.fullName}</p>
                    <p className="text-sm text-mist">{technician.type === 'COMPANY' ? 'FixPro technician' : 'Independent technician'}</p>
                    {technician.verified && <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-lime/15 px-2.5 py-0.5 text-xs font-semibold text-accent">✓ Verified by FixPro</span>}
                  </div>
                </div>
                <a href={`tel:${technician.phone}`} className="btn-primary mt-5 w-full">Call {technician.phone}</a>
                <dl className="mt-5 divide-y divide-white/10">
                  <Row label="Jobs completed">{technician.completedJobs}</Row>
                  <Row label="With FixPro since">{formatDate(technician.memberSince)}</Row>
                  <Row label="Accepted your job">{technician.acceptedAt && formatDateTime(technician.acceptedAt)}</Row>
                  <Row label="Covers">{technician.areas?.join(', ')}</Row>
                </dl>
                {technician.services?.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{technician.services.map((n) => <span key={n} className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-mist">{n}</span>)}</div>}
                {technician.about && <p className="mt-4 text-sm text-mist">{technician.about}</p>}
              </div>
            ) : <p className="text-sm text-mist">{d.assignmentState === 'AWAITING_TECHNICIAN' ? 'A technician is assigned and will confirm shortly. Their details appear here once they accept.' : stage < 0 ? 'No technician was assigned.' : 'We are finding the best technician for your area.'}</p>}
          </Panel>

          <Panel title="When">
            <dl className="divide-y divide-white/10">
              <Row label="You asked for">{b.preferredDate ? `${formatDate(b.preferredDate)}${b.preferredTime ? `, ${windowLabel(b.preferredTime)}` : ''}` : 'Any time'}</Row>
              <Row label="Confirmed">{job?.scheduledFor ? `${formatDate(job.scheduledFor)}, ${windowLabel(job.scheduledWindow)}` : 'Not yet confirmed'}</Row>
            </dl>
          </Panel>

          <Panel title="Your request">
            <dl className="divide-y divide-white/10">
              <Row label="Device">{[b.device.brand, b.device.model, b.device.category].filter(Boolean).join(' ')}</Row>
              <Row label="Where">{[b.address.landmark, b.address.area, b.address.town, b.address.district].filter(Boolean).join(', ')}</Row>
              <Row label="Service type">{b.fulfilmentMethod.replaceAll('_', ' ').toLowerCase()}</Row>
              <Row label="Diagnostic fee">{ugx(b.service.diagnosticFee)}</Row>
            </dl>
            <p className="mt-3 text-sm text-mist">{b.faultDescription}</p>
          </Panel>

          {invoice && <Panel title="Money"><dl><Row label="Spent so far">{ugx(paid)}</Row><Row label="Still to pay">{ugx(invoice.balance)}</Row></dl></Panel>}
        </aside>
      </div>
    </section>
  );
}
