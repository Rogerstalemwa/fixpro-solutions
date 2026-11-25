import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import MiniForm from './MiniForm.jsx';
import { formatDateTime, statusLabel } from '../lib/format.js';

const METHOD = { DOORSTEP: 'Doorstep repair', WORKSHOP: 'Workshop repair', COLLECTION_DELIVERY: 'Collection and delivery' };
const Heading = ({ children, note }) => (
  <>
    <h2 className="mt-20 font-display text-3xl font-bold tracking-tight">{children}</h2>
    {note && <p className="mt-2 max-w-2xl text-sm text-mist">{note}</p>}
  </>
);
const Pill = ({ children, tone = 'bg-white/10' }) => <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{children}</span>;

// ───────── Booking review (requirements 6.1) ─────────
function ReviewItem({ b, onDone }) {
  const [mode, setMode] = useState(null); // 'ask' | 'decline'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); setMode(null); onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const c = b.checks;
  const blocked = !c.covered || !c.fulfilment.available;
  const post = (path, body = {}) => api(`/admin/bookings/${b.id}/${path}`, { method: 'POST', body });

  return (
    <li className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-display text-xl font-bold tracking-tight">{b.service.name}</p>
          <p className="mt-1 text-sm text-mist">
            {b.reference} · {b.customer.user.fullName}, {b.customer.user.phone} · {[b.device.brand, b.device.model, b.device.category].filter(Boolean).join(' ')} · {[b.address.area, b.address.district].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2"><Pill>{statusLabel(b.status)}</Pill><Pill>{METHOD[b.fulfilmentMethod]}</Pill></div>
      </div>
      <p className="mt-3 max-w-2xl text-sm">{b.faultDescription}</p>
      <ul className="mt-3 space-y-1 text-sm">
        <li className={c.covered ? 'text-mist' : 'text-danger'}>{c.covered ? `${c.district} is in our service area` : `${c.district} is not in our service area`}</li>
        <li className={c.fulfilment.available ? 'text-mist' : 'text-danger'}>
          {c.fulfilment.available ? `${METHOD[b.fulfilmentMethod]} is available` : `${c.fulfilment.reason}${c.fulfilment.alternatives.length ? ` Alternatives: ${c.fulfilment.alternatives.join(', ')}.` : ''}`}
        </li>
        {b.attachmentCount > 0 && <li className="text-mist">{b.attachmentCount} attachment{b.attachmentCount === 1 ? '' : 's'} from the customer</li>}
        {b.lastMessage && <li className="text-mist">Last message ({b.lastMessage.authorRole === 'STAFF' ? 'sent by us' : 'from the customer'}): {b.lastMessage.message}</li>}
      </ul>
      <div className="mt-5 flex flex-wrap gap-3">
        {b.status === 'NEW_REQUEST' && <button className="btn-ghost" disabled={busy} onClick={() => run(() => post('start-review'))}>Start review</button>}
        <button className="btn-primary" disabled={busy || blocked} onClick={() => run(() => post('approve'))}>Approve</button>
        <button className="btn-ghost" onClick={() => setMode(mode === 'ask' ? null : 'ask')}>Ask the customer</button>
        <button className="btn-ghost" onClick={() => setMode(mode === 'decline' ? null : 'decline')}>Decline</button>
      </div>
      {mode === 'ask' && <div className="mt-4"><MiniForm submitLabel="Send question" fields={[{ name: 'message', label: 'What do you need to know?', type: 'textarea' }]} onSubmit={(body) => run(() => post('request-clarification', body))} /></div>}
      {mode === 'decline' && <div className="mt-4"><MiniForm submitLabel="Decline booking" fields={[{ name: 'reason', label: 'Reason shown to the customer', type: 'textarea' }]} onSubmit={(body) => run(() => post('decline', body))} /></div>}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </li>
  );
}

export function ReviewQueue({ onChange }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { api('/admin/review/queue').then((r) => setRows(r.data)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  return (
    <>
      <Heading note="New requests wait here until Operations checks the service area and the chosen way of repair. Approved requests move to the queue below.">Bookings to review</Heading>
      {error && <p className="mt-4 text-danger" role="alert">{error}</p>}
      {rows && !rows.length && <p className="mt-4 text-mist">No bookings are waiting for review.</p>}
      <ul className="mt-6 space-y-4">{rows?.map((b) => <ReviewItem key={b.id} b={b} onDone={() => { load(); onChange?.(); }} />)}</ul>
    </>
  );
}

// ───────── Workshops (requirements 8.1) ─────────
export function WorkshopsPanel() {
  const [data, setData] = useState(null);
  const [areas, setAreas] = useState([]);
  const [cats, setCats] = useState([]);
  const [editing, setEditing] = useState(null); // 'new' | workshop id
  const [error, setError] = useState('');
  const load = useCallback(() => {
    Promise.all([api('/admin/workshops'), api('/service-areas'), api('/service-categories')]).then(([w, a, c]) => { setData(w.data); setAreas(a.data); setCats(c.data); }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const FormFor = ({ w }) => {
    const [picked, setPicked] = useState(w?.categoryIds ?? []);
    return (
      <div className="mt-4 space-y-3">
        <MiniForm
          submitLabel={w ? 'Save workshop' : 'Add workshop'}
          initial={w ? { name: w.name, address: w.address ?? '', district: w.district ?? '', contactPerson: w.contactPerson ?? '', contactPhone: w.contactPhone ?? '', operatingHours: w.operatingHours ?? '', managerUserId: w.managerUserId ?? '', status: w.status } : { status: 'ACTIVE' }}
          fields={[
            { name: 'name', label: 'Workshop name', type: 'text' },
            { name: 'address', label: 'Location', type: 'text' },
            { name: 'district', label: 'District', type: 'select', options: areas },
            { name: 'contactPerson', label: 'Contact person', type: 'text' },
            { name: 'contactPhone', label: 'Contact phone', type: 'text' },
            { name: 'operatingHours', label: 'Operating hours', type: 'text', hint: 'For example Mon to Sat, 8:00 to 18:00' },
            { name: 'managerUserId', label: 'Responsible manager', type: 'select', options: data.managers.map((m) => [m.id, `${m.fullName} (${m.phone})`]), hint: 'Create the manager as a user with the Workshop manager role first.' },
            { name: 'status', label: 'Status', type: 'select', options: [['ACTIVE', 'Active'], ['INACTIVE', 'Inactive'], ['SUSPENDED', 'Suspended']] },
          ]}
          onSubmit={async (body) => {
            const payload = { ...body, categoryIds: picked, managerUserId: body.managerUserId || null };
            await (w ? api(`/admin/workshops/${w.id}`, { method: 'PATCH', body: payload }) : api('/admin/workshops', { method: 'POST', body: payload }));
            setEditing(null); load();
          }}
        />
        <fieldset className="rounded-2xl border border-white/10 p-4">
          <legend className="px-1 text-sm font-medium">Repair categories supported</legend>
          <p className="text-xs text-mist">Leave all unticked to accept every category.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {cats.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-lime" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />{c.name}</label>
            ))}
          </div>
        </fieldset>
      </div>
    );
  };

  return (
    <>
      <Heading note="Workshops receive devices from customers or from collection. Link each one to a manager.">Workshops</Heading>
      {error && <p className="mt-4 text-danger" role="alert">{error}</p>}
      <ul className="mt-6 space-y-3">
        {data?.workshops.map((w) => (
          <li key={w.id} className="glass rounded-3xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-bold">{w.name} <Pill tone={w.status === 'ACTIVE' ? 'bg-lime/15 text-accent' : 'bg-white/10'}>{statusLabel(w.status)}</Pill></p>
                <p className="text-sm text-mist">{[w.address, w.district].filter(Boolean).join(', ')} · {w.operatingHours || 'Hours not set'} · Manager: {w.managerName || 'not linked'}</p>
              </div>
              <button className="btn-ghost" onClick={() => setEditing(editing === w.id ? null : w.id)}>{editing === w.id ? 'Close' : 'Edit'}</button>
            </div>
            {editing === w.id && <FormFor w={w} />}
          </li>
        ))}
      </ul>
      {data && <button className="btn-ghost mt-4" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'Close' : 'Add a workshop'}</button>}
      {editing === 'new' && data && <FormFor />}
    </>
  );
}

// ───────── Collection and delivery assignment (requirements 9.2) ─────────
function OrderRow({ o, people, onDone }) {
  const [open, setOpen] = useState(false);
  const attempt = o.attempts?.[0];
  return (
    <li className="glass rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold tracking-tight">{o.orderType === 'COLLECTION' ? 'Collection' : 'Delivery'} · {o.job.booking.reference}</p>
          <p className="text-sm text-mist">{o.equipmentDescription} · {o.pickupAddress} to {o.destinationAddress}</p>
          <p className="text-sm text-mist">Contact: {o.contactName}, {o.contactPhone}{o.preferredTime ? ` · wants ${o.preferredTime}` : ''}{o.scheduledAt ? ` · planned ${formatDateTime(o.scheduledAt)}` : ''}</p>
          {o.person && <p className="text-sm text-mist">Assigned to {o.person.fullName}, {o.person.phone}</p>}
          {o.status === 'FAILED' && attempt && <p className="mt-1 text-sm text-danger">Last problem: {attempt.reason.replaceAll('_', ' ').toLowerCase()}. {attempt.explanation}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Pill>{statusLabel(o.status)}</Pill>
          {['CREATED', 'FAILED'].includes(o.status) && <button className="btn-primary" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Assign'}</button>}
        </div>
      </div>
      {open && (
        <div className="mt-4">
          {!people.length ? <p className="text-sm text-mist">No collection and delivery staff yet. Create a user with the Logistics personnel role.</p> : (
            <MiniForm
              submitLabel="Assign"
              fields={[
                { name: 'personId', label: 'Collection and delivery person', type: 'select', options: people.map((p) => [p.id, `${p.fullName} (${p.phone})`]) },
                { name: 'scheduledAt', label: 'Planned date and time', type: 'datetime' },
                { name: 'transportCharge', label: 'Transport charge (UGX)', type: 'number', default: o.transportCharge || '', hint: 'Recorded for the customer. Add it to the quotation as a transport item.' },
                { name: 'instructions', label: 'Instructions', type: 'textarea', default: o.instructions ?? '' },
              ]}
              onSubmit={(body) => api(`/admin/logistics/orders/${o.id}/assign`, { method: 'POST', body }).then(onDone)}
            />
          )}
        </div>
      )}
    </li>
  );
}

export function LogisticsPanel() {
  const [orders, setOrders] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    Promise.all([api('/admin/logistics/orders'), api('/admin/logistics/personnel')]).then(([o, p]) => { setOrders(o.data); setPeople(p.data); }).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  return (
    <>
      <Heading note="Collections from customers and deliveries after repair. Assign a person to each.">Collection and delivery</Heading>
      {error && <p className="mt-4 text-danger" role="alert">{error}</p>}
      {orders && !orders.length && <p className="mt-4 text-mist">No collections or deliveries are open.</p>}
      <ul className="mt-6 space-y-3">{orders?.map((o) => <OrderRow key={o.id} o={o} people={people} onDone={load} />)}</ul>
    </>
  );
}

// ───────── Sending a booking to a workshop (used by the dispatch queue) ─────────
export function RouteToWorkshop({ job, onDone }) {
  const [workshops, setWorkshops] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/admin/workshops').then((r) => setWorkshops(r.data.workshops.filter((w) => w.status === 'ACTIVE'))).catch((e) => setError(e.message)); }, []);
  const collect = job.booking.fulfilmentMethod === 'COLLECTION_DELIVERY';
  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!workshops) return <p className="text-sm text-mist">Loading workshops…</p>;
  if (!workshops.length) return <p className="text-sm text-mist">No active workshop. Add one under Workshops below.</p>;
  return (
    <MiniForm
      submitLabel="Send to workshop"
      fields={[
        { name: 'workshopId', label: 'Workshop', type: 'select', options: workshops.map((w) => [w.id, `${w.name}, ${w.district}`]) },
        ...(collect ? [
          { name: 'transportCharge', label: 'Transport charge (UGX)', type: 'number' },
          { name: 'instructions', label: 'Collection instructions', type: 'textarea' },
        ] : []),
      ]}
      onSubmit={(body) => api(`/admin/jobs/${job.id}/route-to-workshop`, { method: 'POST', body }).then(onDone)}
    />
  );
}

