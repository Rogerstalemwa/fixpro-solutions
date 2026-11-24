import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { STAFF_ROLES, useAuth } from '../lib/auth.jsx';
import Field from '../components/Field.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(form.identifier, form.password);
      const staff = user.roles.some((r) => STAFF_ROLES.includes(r));
      const tech = user.roles.some((r) => r.endsWith('_TECHNICIAN'));
      navigate(location.state?.from || (staff ? '/admin' : tech ? '/technician' : '/dashboard'), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-md px-5 py-14">
      <h1 className="giant-md">Sign in</h1>
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6">
        <Field label="Phone number or email">
          <input className="input" autoComplete="username" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} required />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-5 text-sm text-mist">New to FixPro? <Link to="/register" className="font-semibold text-accent hover:underline">Create an account</Link></p>
    </section>
  );
}
