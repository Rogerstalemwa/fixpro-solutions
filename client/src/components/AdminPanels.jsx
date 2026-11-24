import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import { fieldErrors } from './Field.jsx';
import { STATUS_STYLE, formatDate, ugx } from '../lib/format.js';

const FILTERS = [['PENDING_REVIEW', 'Pending review'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected'], ['SUSPENDED', 'Suspended'], ['', 'All']];

export function Technicians() {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    const q = new URLSearchParams({ limit: '50', ...(status && { verificationStatus: status }), ...(search.trim() && { search: search.trim() }) });
    const timer = setTimeout(() => { api(`/admin/technicians?${q}`).then(({ data }) => setItems(data)).catch((e) => setError(e.message)); }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [status, search]);

  return (
    <>
      <h2 className="mt-20 font-display text-3xl font-bold tracking-tight">Technicians</h2>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter technicians" className="flex flex-wrap gap-2">
          {FILTERS.map(([value, name]) => (
            <button key={name} role="tab" aria-selected={status === value} onClick={() => setStatus(value)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${status === value ? 'bg-paper text-navy-950' : 'glass text-mist hover:text-white'}`}>{name}</button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search technicians" />
      </div>
      {error && <p className="mt-4 text-sm text-mist">{error}</p>}
      {items && !items.length && <p className="mt-6 text-mist">No technicians match.</p>}
      <ul className="mt-6 space-y-3">
        {items?.map((t) => (
          <li key={t.id}>
            <Link to={`/admin/technicians/${t.id}`} className="glass group flex flex-wrap items-center gap-4 rounded-3xl p-4 transition-colors hover:border-accent/50">
              <Avatar name={t.user.fullName} src={t.photoUrl} className="h-14 w-14" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg font-bold">{t.user.fullName}</p>
                <p className="truncate text-sm text-mist">{t.user.phone} · {t.technicianType.toLowerCase()} · {t.coverageAreas.map((c) => c.district).join(', ') || 'no areas'} · applied {formatDate(t.createdAt)}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[t.verificationStatus]}`}>{t.verificationStatus.replaceAll('_', ' ').toLowerCase()}</span>
              <span className="text-sm font-semibold text-accent group-hover:underline">View details</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function InvoiceRow({ inv, onDone }) {
  const balance = Number(inv.balance);
  const [f, setF] = useState({ amount: balance, method: 'CASH', reference: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setErrors({});
    try { await api(`/admin/invoices/${inv.id}/payments`, { method: 'POST', body: { amount: Number(f.amount), method: f.method, ...(f.reference && { reference: f.reference }) } }); onDone(); }
    catch (err) { setErrors(fieldErrors(err)); setError(err.errors.length ? '' : err.message); } finally { setBusy(false); }
  };
  return (
    <li className="glass rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold">{inv.reference} <span className="text-sm font-normal text-mist">· {inv.job.booking.service.name}</span></p>
          <p className="text-sm text-mist">{inv.customer.user.fullName}, {inv.customer.user.phone} · booking {inv.job.booking.reference}</p>
        </div>
        <p className="text-right text-sm"><span className="text-mist">Balance </span><span className="font-display text-xl font-bold">{ugx(balance)}</span><span className="block text-mist">of {ugx(inv.total)}</span></p>
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[8rem_9rem_1fr_auto]">
        <label className="text-sm">Amount<input className="input mt-1" type="number" min="1" max={balance} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />{errors.amount && <span className="text-xs text-danger">{errors.amount}</span>}</label>
        <label className="text-sm">Method<select className="input mt-1" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="BANK_TRANSFER">Bank transfer</option></select></label>
        <label className="text-sm">Reference<input className="input mt-1" placeholder={f.method === 'CASH' ? 'Optional' : 'Transaction ID'} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />{errors.reference && <span className="text-xs text-danger">{errors.reference}</span>}</label>
        <button className="btn-primary self-end" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
      </form>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </li>
  );
}

export function Payments() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { api('/admin/invoices?limit=50').then(({ data }) => setItems(data)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  return (
    <>
      <h2 className="mt-20 font-display text-3xl font-bold tracking-tight">Payments to record</h2>
      {error && <p className="mt-4 text-sm text-mist">{error}</p>}
      {items && !items.length && <p className="mt-4 text-mist">No unpaid invoices.</p>}
      <ul className="mt-6 space-y-4">{items?.map((inv) => <InvoiceRow key={inv.id} inv={inv} onDone={load} />)}</ul>
    </>
  );
}
