import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Field, { fieldErrors } from '../components/Field.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await register(form);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err.errors.length ? '' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-md px-5 py-14">
      <h1 className="giant-md">Get started</h1>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6" noValidate>
        <Field label="Full name" error={errors.fullName}>
          <input className="input" autoComplete="name" value={form.fullName} onChange={set('fullName')} required />
        </Field>
        <Field label="Phone number" error={errors.phone} hint="We use this to reach you about your repair.">
          <input className="input" type="tel" autoComplete="tel" placeholder="0700 000 000" value={form.phone} onChange={set('phone')} required />
        </Field>
        <Field label="Email (optional)" error={errors.email}>
          <input className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters, with a letter and a number.">
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
        </Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="mt-5 text-sm text-mist">Already registered? <Link to="/login" className="font-semibold text-accent hover:underline">Sign in</Link></p>
      <p className="mt-2 text-sm text-mist">Repair devices for a living? <Link to="/register/technician" className="font-semibold text-white hover:underline">Apply as a technician</Link></p>
    </section>
  );
}
