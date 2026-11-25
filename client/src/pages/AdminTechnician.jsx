import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlob } from '../lib/api.js';
import Avatar from '../components/Avatar.jsx';
import { STATUS_STYLE, formatDate, formatDateTime } from '../lib/format.js';

const label = (s = '') => s.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const age = (d) => { const b = new Date(d); const n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a -= 1; return a; };

const Panel = ({ title, children, className = '' }) => (
  <section className={`glass rounded-3xl p-6 ${className}`}><h2 className="font-display text-xl font-bold tracking-tight">{title}</h2><div className="mt-4">{children}</div></section>
);
const Row = ({ label: l, children }) => (
  <div className="flex justify-between gap-6 py-2.5 text-sm"><dt className="shrink-0 text-mist">{l}</dt><dd className="text-right font-medium">{children || <span className="text-mist">Not provided</span>}</dd></div>
);

const HISTORY = {
  TECHNICIAN_APPLIED: () => 'Applied to join FixPro',
  TECHNICIAN_CREATED: () => 'Created by operations',
  TECHNICIAN_VERIFICATION: (h) => `Status set to ${label(h.newValues?.verificationStatus).toLowerCase()}`,
  TECHNICIAN_NIN_VIEWED: () => 'Full NIN viewed',
};

export default function AdminTechnician() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nin, setNin] = useState('');
  const [idUrl, setIdUrl] = useState('');
  const hideTimer = useRef(null);

  const load = useCallback(() => { api(`/admin/technicians/${id}`).then(({ data }) => setT(data)).catch((e) => setError(e.message)); }, [id]);
  useEffect(load, [load]);
  useEffect(() => () => { clearTimeout(hideTimer.current); }, []);
  useEffect(() => () => { if (idUrl) URL.revokeObjectURL(idUrl); }, [idUrl]);

  const guard = async (fn) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const reveal = () => guard(async () => {
    setNin((await api(`/admin/technicians/${id}/reveal-nin`, { method: 'POST', body: {} })).data.nin);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setNin(''), 60_000); // hides itself after a minute
    load();
  });
  const showId = (doc) => guard(async () => setIdUrl(URL.createObjectURL(await apiBlob(`/admin/technicians/${id}/documents/${doc.id}/file`))));
  const decide = (status, question) => {
    if (!window.confirm(question)) return;
    guard(async () => { await api(`/admin/technicians/${id}/verify`, { method: 'PATCH', body: { status } }); load(); });
  };

  if (error && !t) return <section className="mx-auto max-w-5xl px-5 py-16"><p className="text-danger" role="alert">{error}</p><Link to="/admin" className="btn-ghost mt-6">Back to operations</Link></section>;
  if (!t) return <p className="mx-auto max-w-5xl px-5 py-16 text-mist">Loading…</p>;

  const doc = t.documents.find((d) => d.documentType === 'NATIONAL_ID');
  const checks = [
    ['National ID number', !!t.ninLast4], ['Profile photo', !!t.photoUrl], ['ID photo uploaded', !!doc], ['Date of birth', !!t.dateOfBirth],
    ['Home address', !!t.residenceAddress], ['Next of kin', !!(t.nextOfKinName && t.nextOfKinPhone)],
    ['Services chosen', t.specialisations.length > 0], ['Areas chosen', t.coverageAreas.length > 0],
  ];
  const complete = checks.every(([, ok]) => ok);
  const grouped = t.specialisations.reduce((a, { service }) => { (a[service.category.name] ||= []).push(service.name); return a; }, {});
  const w = t.work;

  return (
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-12 sm:px-8">
      <Link to="/admin" className="text-sm text-mist hover:text-white">← Operations</Link>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <Avatar name={t.user.fullName} src={t.photoUrl} className="h-24 w-24" />
          <div>
            <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">{t.user.fullName}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-mist">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[t.verificationStatus]}`}>{label(t.verificationStatus)}</span>
              {t.technicianType === 'COMPANY' ? 'Company technician' : 'Independent technician'} · applied {formatDate(t.user.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {t.verificationStatus !== 'VERIFIED' && <button className="btn-primary" disabled={busy || !complete} onClick={() => decide('VERIFIED', `Verify ${t.user.fullName}? They will be able to receive jobs.`)}>{t.verificationStatus === 'PENDING_REVIEW' ? 'Verify technician' : 'Reinstate and verify'}</button>}
          {t.verificationStatus === 'PENDING_REVIEW' && <button className="btn-ghost" disabled={busy} onClick={() => decide('REJECTED', `Reject the application from ${t.user.fullName}?`)}>Reject</button>}
          {t.verificationStatus === 'VERIFIED' && <button className="btn-ghost" disabled={busy} onClick={() => decide('SUSPENDED', `Suspend ${t.user.fullName}? They will stop receiving jobs.`)}>Suspend</button>}
        </div>
      </div>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}
      {!complete && t.verificationStatus !== 'VERIFIED' && <p className="mt-6 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">This application is missing required information, so it cannot be verified yet. See the checklist below.</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Contact and account">
          <dl className="divide-y divide-white/10">
            <Row label="Phone"><a className="hover:underline" href={`tel:${t.user.phone}`}>{t.user.phone}</a></Row>
            <Row label="Email">{t.user.email}</Row>
            <Row label="Account">{label(t.user.status)}</Row>
            <Row label="Last sign in">{t.user.lastLoginAt && formatDateTime(t.user.lastLoginAt)}</Row>
            <Row label="Available for jobs">{t.available ? 'Yes' : 'No'}</Row>
          </dl>
        </Panel>

        <Panel title="Identity">
          <dl className="divide-y divide-white/10">
            <Row label="National ID number"><span className="font-mono">{nin || (t.ninLast4 ? `**********${t.ninLast4}` : null)}</span></Row>
            <Row label="Date of birth">{t.dateOfBirth && `${formatDate(t.dateOfBirth)} (${age(t.dateOfBirth)} years)`}</Row>
          </dl>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="btn-ghost" disabled={busy || !t.ninLast4 || !!nin} onClick={reveal}>{nin ? 'Visible for 60 seconds' : 'Reveal full NIN'}</button>
            {doc && !idUrl && <button className="btn-ghost" disabled={busy} onClick={() => showId(doc)}>Show ID photo</button>}
            {idUrl && <button className="btn-ghost" onClick={() => setIdUrl('')}>Hide ID photo</button>}
          </div>
          <p className="mt-2 text-xs text-mist">Revealing the NIN or opening the ID photo is recorded in the audit log.</p>
          {idUrl && <img src={idUrl} alt={`National ID of ${t.user.fullName}`} className="mt-4 max-h-80 w-full rounded-2xl border border-white/10 object-contain" />}
        </Panel>

        <Panel title="Home and next of kin">
          <dl className="divide-y divide-white/10">
            <Row label="District">{t.residenceDistrict}</Row>
            <Row label="Town">{t.residenceTown}</Row>
            <Row label="Address">{t.residenceAddress}</Row>
            <Row label="Next of kin">{t.nextOfKinName}</Row>
            <Row label="Next of kin phone">{t.nextOfKinPhone && <a className="hover:underline" href={`tel:${t.nextOfKinPhone}`}>{t.nextOfKinPhone}</a>}</Row>
          </dl>
        </Panel>

        <Panel title="Verification checklist">
          <ul className="space-y-2.5 text-sm">
            {checks.map(([name, ok]) => (
              <li key={name} className="flex items-center gap-3"><span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${ok ? 'bg-lime text-ink' : 'bg-danger/15 text-danger'}`}>{ok ? '✓' : '!'}</span><span className={ok ? '' : 'text-danger'}>{name}</span></li>
            ))}
          </ul>
        </Panel>

        <Panel title="Experience" className="lg:col-span-2"><p className="whitespace-pre-line text-sm leading-relaxed">{t.experienceSummary || <span className="text-mist">Not provided</span>}</p></Panel>

        <Panel title="What they can repair">
          {!t.specialisations.length ? <p className="text-sm text-mist">No services chosen.</p> : Object.entries(grouped).map(([cat, names]) => (
            <div key={cat} className="mb-4 last:mb-0"><p className="mb-2 text-xs text-mist">{cat}</p><div className="flex flex-wrap gap-2">{names.map((n) => <span key={n} className="rounded-full border border-white/15 px-3 py-1 text-sm">{n}</span>)}</div></div>
          ))}
        </Panel>

        <div className="space-y-6">
          <Panel title="Areas covered">
            <div className="flex flex-wrap gap-2">{t.coverageAreas.filter((c) => c.active).map((c) => <span key={c.district + (c.town || '')} className="rounded-full border border-white/15 px-3 py-1 text-sm">{c.district}{c.town ? `, ${c.town}` : ''}</span>)}{!t.coverageAreas.length && <p className="text-sm text-mist">No areas chosen.</p>}</div>
          </Panel>
          <Panel title="Work record">
            <dl className="divide-y divide-white/10">
              <Row label="Jobs completed">{w.COMPLETED || 0}</Row>
              <Row label="In progress or offered">{(w.ACCEPTED || 0) + (w.OFFERED || 0)}</Row>
              <Row label="Declined">{w.DECLINED || 0}</Row>
            </dl>
          </Panel>
        </div>

        <Panel title="History" className="lg:col-span-2">
          {!t.history.length ? <p className="text-sm text-mist">No recorded activity.</p> : (
            <ol className="space-y-3">
              {[...t.history].reverse().map((h, i) => (
                <li key={i} className="flex gap-4 text-sm"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-lime' : 'bg-white/25'}`} /><div><p className="font-medium">{(HISTORY[h.action] || (() => label(h.action)))(h)}{h.by ? <span className="font-normal text-mist"> · by {h.by}</span> : ''}</p><p className="text-xs text-mist">{formatDateTime(h.createdAt)}</p></div></li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </section>
  );
}
