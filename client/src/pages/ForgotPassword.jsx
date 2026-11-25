import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import Field, { fieldErrors } from '../components/Field.jsx';

// Account recovery: a one-time code is sent to the phone or email, then a new password is chosen.
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn) => { setBusy(true); setError(''); setErrors({}); try { await fn(); } catch (e) { setErrors(fieldErrors(e)); setError(e.errors?.length ? '' : e.message); } finally { setBusy(false); } };
  const request = (e) => { e.preventDefault(); run(async () => { const { message: m } = await api('/auth/forgot-password', { method: 'POST', body: { identifier } }); setMessage(m); setStep(2); }); };
  const reset = (e) => { e.preventDefault(); run(async () => { await api('/auth/reset-password', { method: 'POST', body: { identifier, code, password } }); navigate('/login', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } }); }); };

  return (
    <section className="mx-auto max-w-md px-5 py-14">
      <h1 className="giant-md">{step === 1 ? 'Forgot password' : 'New password'}</h1>
      {step === 1 ? (
        <form onSubmit={request} className="glass mt-8 space-y-4 rounded-3xl p-6">
          <p className="text-sm text-mist">Enter the phone number or email you signed up with. We will send a 6-digit code.</p>
          <Field label="Phone number or email" error={errors.identifier}><input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required /></Field>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form onSubmit={reset} className="glass mt-8 space-y-4 rounded-3xl p-6">
          <p className="text-sm text-mist">{message} The code works for 15 minutes.</p>
          <Field label="6-digit code" error={errors.code}><input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus /></Field>
          <Field label="New password" error={errors.password} hint="At least 8 characters, with a letter and a number."><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Saving…' : 'Change password'}</button>
          <button type="button" className="w-full text-sm text-mist hover:text-white" onClick={() => setStep(1)}>Use a different phone or email</button>
        </form>
      )}
      <p className="mt-5 text-sm text-mist"><Link to="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link></p>
    </section>
  );
}
