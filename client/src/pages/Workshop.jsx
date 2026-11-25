import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import MiniForm from '../components/MiniForm.jsx';
import { Reveal } from '../lib/motion.jsx';
import { statusLabel, ugx } from '../lib/format.js';

const TABS = [['ARRIVING', 'Arriving'], ['DIAGNOSIS', 'Diagnosis'], ['REPAIR', 'Repair'], ['QUALITY', 'Quality check'], ['READY', 'Ready to release']];
const METHOD = { WORKSHOP: 'Customer brings it in', COLLECTION_DELIVERY: 'Collect and deliver' };

function AssignTechnician({ job, onDone }) {
  const [techs, setTechs] = useState(null);
  useEffect(() => { api(`/workshop/jobs/${job.id}/technicians`).then((r) => setTechs(r.data)).catch(() => setTechs([])); }, [job.id]);
  if (!techs) return <p className="text-sm text-mist">Loading technicians…</p>;
  if (!techs.length) return <p className="text-sm text-mist">No verified company technician is trained for this service.</p>;
  return (
    <MiniForm
      submitLabel={job.technician ? 'Change technician' : 'Assign technician'}
      fields={[{ name: 'technicianId', label: 'Workshop technician', type: 'select', options: techs.map((t) => [t.id, `${t.fullName} (${t.activeJobs} active)`]) }]}
      onSubmit={(body) => api(`/workshop/jobs/${job.id}/assign-technician`, { method: 'POST', body }).then(onDone)}
    />
  );
}

function Actions({ job, onDone, isOps }) {
  const id = job.id;
  const post = (path) => (body) => api(`/workshop/jobs/${id}/${path}`, { method: 'POST', body }).then(onDone);
  const orderOpen = job.orders.find((o) => o.orderType === 'COLLECTION');

  if (job.stage === 'ARRIVING') {
    const waiting = job.booking.fulfilmentMethod === 'COLLECTION_DELIVERY' && !['COLLECTED', 'IN_TRANSIT'].includes(orderOpen?.status);
    if (waiting) return <p className="text-sm text-mist">Waiting for the device to be collected from the customer{orderOpen ? ` (${statusLabel(orderOpen.status)})` : ''}. You can receive it once it has been collected.</p>;
    return (
      <MiniForm
        multipart submitLabel="Record reception"
        fields={[
          { name: 'receivedCondition', label: 'Physical condition', type: 'textarea' },
          { name: 'existingDamage', label: 'Existing damage', type: 'textarea' },
          { name: 'accessoriesReceived', label: 'Accessories received', type: 'text', hint: 'Write None if there are none' },
          { name: 'serialNumber', label: 'Serial number (if available)', type: 'text' },
          { name: 'inspectionNotes', label: 'Notes', type: 'text' },
          { name: 'photos', label: 'Photographs', type: 'file', max: 6 },
        ]}
        onSubmit={(body) => api(`/workshop/jobs/${id}/receive`, { method: 'POST', body }).then(onDone)}
      />
    );
  }
  if (job.stage === 'DIAGNOSIS') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-mist">{job.status === 'AWAITING_APPROVAL' ? 'Waiting for the customer to approve the quotation.' : job.technician ? 'The technician is diagnosing the device and will send a quotation.' : 'Assign a technician to diagnose the device.'}</p>
        {job.status === 'INSPECTION' && <AssignTechnician job={job} onDone={onDone} />}
      </div>
    );
  }
  if (job.stage === 'REPAIR') {
    return (
      <div className="space-y-3">
        {!job.technician && <AssignTechnician job={job} onDone={onDone} />}
        {job.status === 'APPROVED' && <button className="btn-primary" onClick={() => post('start-repair')({})}>Start repair</button>}
        {job.status === 'WORKSHOP_REPAIR' && (
          <>
            <MiniForm
              submitLabel="Record"
              fields={[
                { name: 'activityType', label: 'Type', type: 'select', default: 'ACTIVITY', options: [['ACTIVITY', 'Repair activity'], ['PART_REQUEST', 'Replacement part request'], ['TEST_RESULT', 'Test result'], ['NOTE', 'Note']] },
                { name: 'notes', label: 'Details', type: 'textarea' },
              ]}
              onSubmit={post('activity')}
            />
            <button className="btn-ghost" onClick={() => post('request-quality-check')({})}>Repair complete: request quality inspection</button>
          </>
        )}
      </div>
    );
  }
  if (job.stage === 'QUALITY') {
    return (
      <div className="space-y-3">
        {!job.hasServiceReport && <p className="text-sm text-danger">The technician has not submitted the service report yet. It is needed before the device can be approved.</p>}
        <MiniForm
          submitLabel="Save inspection"
          fields={[
            { name: 'testsPerformed', label: 'Tests performed', type: 'textarea' },
            { name: 'testResults', label: 'Test results', type: 'textarea' },
            { name: 'outstandingIssues', label: 'Outstanding issues', type: 'textarea' },
            { name: 'passed', label: 'Final approval', type: 'bool', yes: 'Passed', no: 'Failed: return to repair' },
            ...(isOps ? [{ name: 'waive', label: 'Waive the quality check', type: 'checkbox', checkLabel: 'Approve without a pass (Operations only)' }, { name: 'waiverReason', label: 'Reason for waiving', type: 'text', show: (v) => v.waive }] : []),
          ]}
          onSubmit={post('quality-check')}
        />
      </div>
    );
  }
  // READY
  const walkIn = job.booking.fulfilmentMethod === 'WORKSHOP';
  const unpaid = job.invoice && Number(job.invoice.balance) > 0;
  const deliveryOrder = job.orders.find((o) => o.orderType === 'DELIVERY');
  if (!walkIn && deliveryOrder) return <p className="text-sm text-mist">Released. Delivery {deliveryOrder.reference} is {statusLabel(deliveryOrder.status).toLowerCase()}.</p>;
  return (
    <div className="space-y-3">
      <p className={`text-sm ${unpaid ? 'text-danger' : 'text-mist'}`}>{job.invoice ? (unpaid ? `Payment outstanding: ${ugx(job.invoice.balance)}. Payment must be recorded before release.` : 'Invoice paid.') : 'No invoice found.'}</p>
      <MiniForm
        submitLabel={walkIn ? 'Release to customer' : 'Release for delivery'}
        fields={[
          { name: 'conditionAtRelease', label: 'Condition at release', type: 'textarea' },
          { name: 'accessoriesReleased', label: 'Accessories returned', type: 'text', hint: 'Write None if there are none' },
          ...(walkIn ? [{ name: 'collectedBy', label: 'Name of the person collecting', type: 'text' }] : []),
          ...(isOps && unpaid ? [{ name: 'waivePayment', label: 'Payment', type: 'checkbox', checkLabel: 'Release without full payment (Operations only)' }, { name: 'waiverReason', label: 'Reason', type: 'text', show: (v) => v.waivePayment }] : []),
        ]}
        onSubmit={post('release')}
      />
    </div>
  );
}

function JobCard({ job, onDone, isOps }) {
  const b = job.booking;
  return (
    <Reveal as="li" className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-bold tracking-tight">{b.service.name}</p>
          <p className="mt-1 text-sm text-mist">{b.reference} · {[b.device.brand, b.device.model, b.device.category].filter(Boolean).join(' ')} · {METHOD[b.fulfilmentMethod]}</p>
          <p className="text-sm text-mist">Customer: {b.contactName || b.customer.user.fullName}, {b.contactPhone || b.customer.user.phone}</p>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">{statusLabel(job.status)}</span>
      </div>
      <p className="mt-3 text-sm">{b.faultDescription}</p>
      <p className="mt-2 text-xs text-mist">
        {job.technician ? `Technician: ${job.technician.fullName}, ${job.technician.phone}` : 'No technician assigned'}
        {job.quotation ? ` · Quotation ${statusLabel(job.quotation.status).toLowerCase()} (${ugx(job.quotation.total)})` : ''}
        {job.invoice ? ` · Invoice ${statusLabel(job.invoice.status).toLowerCase()}` : ''}
      </p>
      {job.activities.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs text-mist">
          {job.activities.map((a) => <li key={a.id}><span className="font-medium text-paper">{statusLabel(a.activityType)}</span> · {a.recordedBy}: {a.notes}</li>)}
        </ul>
      )}
      <div className="mt-5"><Actions job={job} onDone={onDone} isOps={isOps} /></div>
    </Reveal>
  );
}

export default function Workshop() {
  const { user } = useAuth();
  const isOps = user.roles.includes('OPERATIONS_ADMIN') || user.roles.includes('SUPER_ADMIN');
  const [me, setMe] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [tab, setTab] = useState('ARRIVING');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    Promise.all([api('/workshop/me'), api('/workshop/jobs')]).then(([m, j]) => { setMe(m.data); setJobs(j.data); setError(''); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, [load]);
  const count = (stage) => jobs?.filter((j) => j.stage === stage).length ?? 0;
  const visible = jobs?.filter((j) => j.stage === tab) ?? [];

  return (
    <section className="mx-auto max-w-5xl px-5 pb-10 pt-16 sm:px-8 sm:pt-24">
      <h1 className="giant-md">Workshop</h1>
      {me && <p className="mt-4 text-mist">{me.workshops.map((w) => `${w.name}, ${w.district}`).join(' · ')}</p>}
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}
      <div role="tablist" className="glass scrollbar-none mt-10 flex gap-1 overflow-x-auto rounded-full p-1.5">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${tab === key ? 'bg-paper text-navy-950' : 'text-mist hover:text-white'}`}>
            {label} <span className="ml-1 text-xs opacity-60">{count(key)}</span>
          </button>
        ))}
      </div>
      {jobs && !visible.length && <p className="mt-10 text-mist">Nothing here right now.</p>}
      <ul className="mt-8 space-y-4">{visible.map((j) => <JobCard key={j.id} job={j} onDone={load} isOps={isOps} />)}</ul>
    </section>
  );
}
