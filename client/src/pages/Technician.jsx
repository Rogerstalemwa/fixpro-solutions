import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import Updates from '../components/Updates.jsx';
import { ConfirmForm, InspectionForm, QuotationForm, ReportForm } from '../components/JobForms.jsx';
import { Reveal } from '../lib/motion.jsx';
import { formatDate, statusLabel, ugx, windowLabel } from '../lib/format.js';

const VERIFY_TEXT = {
  PENDING_REVIEW: ['Your application is under review', 'FixPro is checking your details and ID. You will be notified when you are verified, usually within a few days.'],
  NOT_SUBMITTED: ['Your profile is incomplete', 'Finish your profile so we can verify you.'],
  REJECTED: ['Your application was not approved', 'Contact FixPro support to find out why and how to reapply.'],
  SUSPENDED: ['Your account is suspended', 'Contact FixPro support.'],
  EXPIRED: ['Your verification has expired', 'Contact FixPro support to renew it.'],
};

function JobCard({ j, run, busy }) {
  const { booking: b, job } = j;
  const offered = j.assignmentStatus === 'OFFERED';
  const id = job.id;
  const [revising, setRevising] = useState(false);
  const move = (status, label) => <button key={status} className="btn-primary" disabled={busy === id + status} onClick={() => run(id + status, () => api(`/jobs/${id}/status`, { method: 'POST', body: { status } }))}>{label}</button>;
  const post = (path) => (body) => api(`/jobs/${id}/${path}`, { method: 'POST', body }).then(() => run(null));
  const fee = b.service.diagnosticFee;
  const revisionNote = j.quotation?.status === 'REVISION_REQUESTED' ? j.quotation.revisionNote : null;

  let actions = null;
  if (offered) {
    actions = (
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" disabled={busy === id} onClick={() => run(id, () => api(`/technician/jobs/${id}/accept`, { method: 'POST', body: {} }))}>Accept job</button>
        <button className="btn-ghost" disabled={busy === id} onClick={() => { const reason = window.prompt('Why are you declining this job?'); if (reason) run(id, () => api(`/technician/jobs/${id}/decline`, { method: 'POST', body: { reason } })); }}>Decline</button>
      </div>
    );
  } else if (job.atWorkshop && ['APPROVED', 'WORKSHOP_REPAIR', 'QUALITY_CHECK', 'READY_FOR_HANDOVER'].includes(job.status)) {
    // Workshop jobs: the bench repair, then quality inspection and release are handled with the workshop manager.
    actions = job.status === 'APPROVED' ? move('WORKSHOP_REPAIR', 'Start workshop repair')
      : job.status === 'WORKSHOP_REPAIR' ? (<>{!j.hasServiceReport && <ReportForm onSubmit={post('service-report')} />}<div className="mt-3">{move('QUALITY_CHECK', 'Repair done: request quality inspection')}</div></>)
      : job.status === 'QUALITY_CHECK' ? (j.hasServiceReport ? <p className="text-sm text-mist">Waiting for the workshop quality inspection.</p> : <ReportForm onSubmit={post('service-report')} />)
      : <p className="text-sm text-mist">Approved at quality inspection. The workshop will release the device once payment is confirmed.</p>;
  } else if (job.status === 'ACCEPTED') {
    actions = (<><ConfirmForm booking={b} onSubmit={(body) => api(`/jobs/${id}/status`, { method: 'POST', body: { status: 'APPOINTMENT_CONFIRMED', ...body } }).then(() => run(null))} /><div className="mt-3">{move('TECHNICIAN_EN_ROUTE', 'I am on my way')}</div></>);
  } else if (job.status === 'APPOINTMENT_CONFIRMED') {
    actions = move('TECHNICIAN_EN_ROUTE', 'I am on my way');
  } else if (job.status === 'TECHNICIAN_EN_ROUTE') {
    actions = move('INSPECTION', 'Start inspection');
  } else if (job.status === 'INSPECTION') {
    actions = !j.inspection ? <InspectionForm booking={b} onSubmit={post('inspection')} />
      : <QuotationForm diagnosticFee={fee} note={revisionNote} onSubmit={(body) => api(`/jobs/${id}/quotation`, { method: 'POST', body }).then(() => run(null))} />;
  } else if (job.status === 'AWAITING_APPROVAL') {
    actions = (<>
      <p className="text-sm text-mist">Waiting for the customer to respond to quotation {j.quotation ? `of ${ugx(j.quotation.total)}` : ''}.</p>
      <button className="mt-3 text-sm text-mist underline hover:text-white" onClick={() => setRevising(!revising)}>{revising ? 'Close' : 'Send a revised quotation'}</button>
      {revising && <QuotationForm diagnosticFee={fee} onSubmit={(body) => api(`/jobs/${id}/quotation`, { method: 'POST', body }).then(() => { setRevising(false); run(null); })} />}
    </>);
  } else if (job.status === 'APPROVED') {
    actions = move('IN_PROGRESS', 'Start repair');
  } else if (job.status === 'IN_PROGRESS') {
    actions = (<>{!j.hasServiceReport && <ReportForm onSubmit={post('service-report')} />}<div className="mt-3">{move('QUALITY_CHECK', 'Repair done: start quality check')}</div></>);
  } else if (job.status === 'QUALITY_CHECK') {
    actions = j.hasServiceReport ? move('READY_FOR_HANDOVER', 'Ready for handover') : <ReportForm onSubmit={post('service-report')} />;
  } else if (job.status === 'READY_FOR_HANDOVER') {
    actions = <p className="text-sm text-mist">Waiting for payment to be confirmed. The job completes once the invoice is paid.</p>;
  }

  return (
    <div className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-bold tracking-tight">{b.service.name}</p>
          <p className="mt-1 text-sm text-mist">{b.reference} · {[b.device.brand, b.device.model, b.device.category].filter(Boolean).join(' ')}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">{offered ? 'Offered to you' : statusLabel(job.status)}</span>
      </div>
      <p className="mt-4 text-sm">{b.faultDescription}</p>
      <p className="mt-3 text-sm text-mist">
        {[b.address.landmark, b.address.street, b.address.area, b.address.town, b.address.district].filter(Boolean).join(', ')}
        {' · '}{job.scheduledFor ? `visit ${formatDate(job.scheduledFor)}, ${windowLabel(job.scheduledWindow)}` : b.preferredDate ? `wants ${formatDate(b.preferredDate)}${b.preferredTime ? `, ${windowLabel(b.preferredTime)}` : ''}` : 'any time'}
      </p>
      {b.customer && <p className="mt-1 text-sm text-mist">Customer: {b.customer.fullName}, <a className="underline" href={`tel:${b.customer.phone}`}>{b.customer.phone}</a></p>}
      {offered && <p className="mt-1 text-xs text-mist">The exact address and customer contact appear after you accept.</p>}
      <div className="mt-5">{actions}</div>
    </div>
  );
}

export default function Technician() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    Promise.all([api('/technicians/me/jobs'), api('/technicians/me')]).then(([j, m]) => { setJobs(j.data); setMe(m.data); }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // Runs an action, then refreshes. Pass null as fn to just refresh.
  const run = async (key, fn) => {
    setError('');
    if (!fn) { load(); return; }
    setBusy(key);
    try { await fn(); load(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const toggle = () => run('avail', () => api('/technicians/me/availability', { method: 'PATCH', body: { available: !me.available } }));
  const uploadPhoto = (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('photo', file);
    run('photo', () => api('/technicians/me/photo', { method: 'POST', body: fd }));
  };

  const verified = me?.verificationStatus === 'VERIFIED';
  const [vTitle, vText] = VERIFY_TEXT[me?.verificationStatus] || [];

  return (
    <section className="mx-auto max-w-5xl px-5 pb-10 pt-14 sm:px-8">
      <div className="flex items-center gap-5">
        {me && <Avatar name={user.fullName} src={me.photoUrl} className="h-20 w-20" />}
        <h1 className="giant-md">Hello, {user.fullName.split(' ')[0]}</h1>
      </div>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}

      {me && !verified && (
        <div className="glass mt-10 rounded-3xl p-6 ring-1 ring-white/20">
          <p className="font-display text-xl font-bold">{vTitle}</p>
          <p className="mt-1 text-mist">{vText}</p>
        </div>
      )}
      {me && !me.photoUrl && (
        <label className="glass mt-4 block rounded-3xl p-6 text-sm">
          <span className="font-semibold">Add your profile photo.</span> Customers see it when you are assigned to their job.
          <input type="file" accept="image/jpeg,image/png,image/webp" className="input mt-3" onChange={(e) => uploadPhoto(e.target.files[0])} />
        </label>
      )}
      {verified && (
        <div className="glass mt-10 flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6">
          <div>
            <p className="font-display text-xl font-bold">{me.available ? 'You are available for jobs' : 'You are not taking jobs'}</p>
            <p className="text-sm text-mist">Operations can only offer jobs while you are available.</p>
          </div>
          <button className={me.available ? 'btn-ghost' : 'btn-primary'} onClick={toggle} disabled={busy === 'avail'}>{me.available ? 'Go offline' : 'Go available'}</button>
        </div>
      )}

      <div className="mt-14 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Your jobs</h2>
          {jobs && !jobs.length && <p className="mt-4 text-mist">No jobs right now. New offers appear here.</p>}
          <ul className="mt-6 space-y-4">
            {jobs?.map((j, i) => <Reveal as="li" key={j.assignmentId} delay={i * 60}><JobCard j={j} run={run} busy={busy} /></Reveal>)}
          </ul>
        </div>
        <aside><Updates /></aside>
      </div>
    </section>
  );
}
