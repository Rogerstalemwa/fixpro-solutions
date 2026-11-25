import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

// Phone and email verification (requirements 4.2). Shown until each is confirmed.
function Row({ channel, label, target, onDone }) {
  const [step, setStep] = useState('idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const send = () => run(async () => { await api('/auth/verify/request', { method: 'POST', body: { channel } }); setStep('code'); });
  const confirm = (e) => { e.preventDefault(); run(async () => { await api('/auth/verify/confirm', { method: 'POST', body: { channel, code } }); onDone(); }); };
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="min-w-0 flex-1">Verify your {label} <span className="text-mist">({target})</span></span>
      {step === 'idle' ? <button className="btn-ghost !py-1.5" onClick={send} disabled={busy}>Send code</button> : (
        <form onSubmit={confirm} className="flex items-center gap-2">
          <input className="input !w-28" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Verification code" autoFocus />
          <button className="btn-primary !py-1.5" disabled={busy || code.length !== 6}>Confirm</button>
        </form>
      )}
      {error && <span className="w-full text-danger" role="alert">{error}</span>}
    </div>
  );
}

export default function VerifyBanner() {
  const { user, setSessionUser } = useAuth();
  if (!user) return null;
  const refresh = () => api('/auth/me').then(({ data }) => setSessionUser(data)).catch(() => {});
  const needPhone = !user.phoneVerified;
  const needEmail = !!user.email && !user.emailVerified;
  if (!needPhone && !needEmail) return null;
  return (
    <div className="glass mb-8 space-y-3 rounded-3xl p-5 ring-1 ring-white/15">
      {needPhone && <Row channel="PHONE" label="phone number" target={user.phone} onDone={refresh} />}
      {needEmail && <Row channel="EMAIL" label="email" target={user.email} onDone={refresh} />}
    </div>
  );
}
