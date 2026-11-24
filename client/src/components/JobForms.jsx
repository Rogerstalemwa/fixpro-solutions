import { useState } from 'react';
import { ugx } from '../lib/format.js';
import { fieldErrors } from './Field.jsx';

const WINDOWS = ['09:00-12:00', '12:00-15:00', '15:00-18:00'];
const today = () => new Date().toISOString().slice(0, 10);

// Shared wrapper: runs the submit handler and shows API errors under the form.
function useSubmit(onSubmit) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const run = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    try { await onSubmit(); } catch (err) { setErrors(fieldErrors(err)); setError(err.errors?.length ? 'Please check the highlighted fields.' : err.message); } finally { setBusy(false); }
  };
  return { busy, error, errors, run };
}

const Err = ({ msg }) => (msg ? <span className="mt-1 block text-xs text-danger">{msg}</span> : null);
const Box = ({ title, children, onSubmit, busy, error, cta }) => (
  <form onSubmit={onSubmit} className="mt-5 space-y-3 rounded-2xl border border-white/10 bg-white/[.03] p-4">
    <p className="font-semibold">{title}</p>
    {children}
    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : cta}</button>
  </form>
);

export function ConfirmForm({ booking, onSubmit }) {
  const [date, setDate] = useState(booking.preferredDate ? booking.preferredDate.slice(0, 10) : today());
  const [win, setWin] = useState(WINDOWS.includes(booking.preferredTime) ? booking.preferredTime : WINDOWS[0]);
  const s = useSubmit(() => onSubmit({ scheduledDate: date, scheduledWindow: win }));
  return (
    <Box title="Confirm the appointment with the customer" onSubmit={s.run} busy={s.busy} error={s.error} cta="Confirm appointment">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Date<input className="input mt-1" type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} required /><Err msg={s.errors.scheduledDate} /></label>
        <label className="text-sm">Time window<select className="input mt-1" value={win} onChange={(e) => setWin(e.target.value)}>{WINDOWS.map((w) => <option key={w}>{w}</option>)}</select></label>
      </div>
    </Box>
  );
}

export function InspectionForm({ booking, onSubmit }) {
  const [f, setF] = useState({ reportedSymptoms: booking.faultDescription || '', findings: '', recommendedAction: '', estimatedWork: '' });
  const s = useSubmit(() => onSubmit(Object.fromEntries(Object.entries(f).filter(([, v]) => v))));
  const field = (k, label, rows = 2) => (
    <label className="block text-sm">{label}<textarea className="input mt-1" rows={rows} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /><Err msg={s.errors[k]} /></label>
  );
  return (
    <Box title="Inspection report" onSubmit={s.run} busy={s.busy} error={s.error} cta="Save inspection">
      {field('reportedSymptoms', 'What the customer reported')}
      {field('findings', 'What you found', 3)}
      {field('recommendedAction', 'What you recommend')}
      {field('estimatedWork', 'Estimated work (optional)')}
    </Box>
  );
}

export function QuotationForm({ diagnosticFee, note, onSubmit }) {
  const [items, setItems] = useState([{ itemType: 'LABOUR', description: '', quantity: 1, unitPrice: '' }]);
  const s = useSubmit(() => onSubmit({ items: items.map((i) => ({ ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })) }));
  const set = (idx, k, v) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const fee = Number(diagnosticFee || 0);
  const total = fee + items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  return (
    <Box title="Quotation for the customer" onSubmit={s.run} busy={s.busy} error={s.error} cta="Send quotation">
      {note && <p className="rounded-xl bg-lime/10 px-3 py-2 text-sm">Customer asked for changes: {note}</p>}
      {fee > 0 && <p className="text-sm text-mist">The diagnostic fee of {ugx(fee)} is added automatically.</p>}
      {items.map((it, idx) => (
        <div key={idx} className="grid gap-2 sm:grid-cols-[7rem_1fr_5rem_8rem_auto]">
          <select className="input" value={it.itemType} onChange={(e) => set(idx, 'itemType', e.target.value)} aria-label="Type"><option value="LABOUR">Labour</option><option value="PART">Part</option></select>
          <input className="input" placeholder="Description" value={it.description} onChange={(e) => set(idx, 'description', e.target.value)} aria-label="Description" required />
          <input className="input" type="number" min="0.5" step="0.5" value={it.quantity} onChange={(e) => set(idx, 'quantity', e.target.value)} aria-label="Quantity" />
          <input className="input" type="number" min="0" placeholder="Price (UGX)" value={it.unitPrice} onChange={(e) => set(idx, 'unitPrice', e.target.value)} aria-label="Unit price" required />
          <button type="button" className="btn-ghost !px-3" onClick={() => setItems(items.filter((_, i) => i !== idx))} disabled={items.length === 1} aria-label="Remove item">×</button>
        </div>
      ))}
      <button type="button" className="text-sm text-mist hover:text-white" onClick={() => setItems([...items, { itemType: 'PART', description: '', quantity: 1, unitPrice: '' }])}>+ Add another item</button>
      <p className="text-right font-display text-xl font-bold">Total {ugx(total)}</p>
    </Box>
  );
}

export function ReportForm({ onSubmit }) {
  const [f, setF] = useState({ workPerformed: '', partsReplaced: '', testResults: '', recommendations: '' });
  const s = useSubmit(() => onSubmit(Object.fromEntries(Object.entries(f).filter(([, v]) => v))));
  const field = (k, label, rows = 2) => (
    <label className="block text-sm">{label}<textarea className="input mt-1" rows={rows} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /><Err msg={s.errors[k]} /></label>
  );
  return (
    <Box title="Service report" onSubmit={s.run} busy={s.busy} error={s.error} cta="Save report">
      {field('workPerformed', 'Work performed', 3)}
      {field('partsReplaced', 'Parts replaced (optional)')}
      {field('testResults', 'How you tested the repair')}
      {field('recommendations', 'Advice for the customer (optional)')}
    </Box>
  );
}
