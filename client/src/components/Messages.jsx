import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

// A conversation about one booking between the customer, the assigned technician and FixPro.
export default function Messages({ bookingId, title = 'Messages', hint, quotationId }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => { api(`/bookings/${bookingId}/messages`).then(({ data }) => setItems(data)).catch((e) => setError(e.message)); }, [bookingId]);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError('');
    try { await api(`/bookings/${bookingId}/messages`, { method: 'POST', body: { message: text, ...(quotationId && { quotationId }) } }); setText(''); load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <section className="glass rounded-3xl p-6">
      <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
      {hint && <p className="mt-1 text-sm text-mist">{hint}</p>}
      <ul className="mt-4 max-h-96 space-y-3 overflow-y-auto">
        {items && !items.length && <li className="text-sm text-mist">No messages yet.</li>}
        {items?.map((m) => (
          <li key={m.id} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${m.mine ? 'ml-auto bg-lime/15' : 'bg-white/10'}`}>
            <p className="text-xs text-mist">{m.mine ? 'You' : m.author}{m.authorRole === 'TECHNICIAN' ? ' (technician)' : ''} · {formatDateTime(m.createdAt)}</p>
            {m.kind === 'CLARIFICATION_REQUEST' && <p className="mt-1 text-xs font-semibold text-accent">FixPro needs more information</p>}
            <p className="mt-1 whitespace-pre-line">{m.message}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={send} className="mt-4 flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" maxLength={1000} aria-label="Message" />
        <button className="btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </section>
  );
}
