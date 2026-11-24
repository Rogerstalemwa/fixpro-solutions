import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Field, { fieldErrors } from '../components/Field.jsx';
import { Line } from '../lib/motion.jsx';

const empty = {
  fullName: '', phone: '', email: '', password: '', nin: '', dateOfBirth: '', residenceDistrict: '', residenceTown: '', residenceAddress: '',
  nextOfKinName: '', nextOfKinPhone: '', experienceSummary: '',
};

const Section = ({ title, hint, children }) => (
  <fieldset className="glass space-y-4 rounded-3xl p-6 sm:p-8">
    <legend className="px-1 font-display text-xl font-bold tracking-tight">{title}</legend>
    {hint && <p className="-mt-2 text-sm text-mist">{hint}</p>}
    {children}
  </fieldset>
);

export default function TechnicianRegister() {
  const { setSessionUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [services, setServices] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [serviceIds, setServiceIds] = useState([]);
  const [areas, setAreas] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [idDocument, setIdDocument] = useState(null);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    Promise.all([api('/services'), api('/service-areas')]).then(([s, a]) => { setServices(s.data); setDistricts(a.data); setForm((f) => ({ ...f, residenceDistrict: a.data[0] || '' })); }).catch((e) => setError(e.message));
  }, []);

  const grouped = useMemo(() => services.reduce((acc, s) => { (acc[s.category.name] ||= []).push(s); return acc; }, {}), [services]);
  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => v !== '' && fd.append(k, v));
    serviceIds.forEach((id) => fd.append('serviceIds', id));
    areas.forEach((d) => fd.append('districts', d));
    fd.append('consent', String(consent));
    if (photo) fd.append('photo', photo);
    if (idDocument) fd.append('idDocument', idDocument);
    try {
      const { data } = await api('/technicians/register', { method: 'POST', body: fd });
      setSessionUser(data.user);
      navigate('/technician', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err.errors.length ? 'Please fix the highlighted fields.' : err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setBusy(false); }
  };

  const text = (k, label, props = {}, hint) => (
    <Field label={label} error={errors[k]} hint={hint}><input className="input" value={form[k]} onChange={set(k)} {...props} /></Field>
  );

  return (
    <section className="mx-auto max-w-3xl px-5 pb-10 pt-14 sm:px-8">
      <h1 className="giant-md"><Line>Work with</Line><Line delay={100}><span className="accent">FixPro.</span></Line></h1>
      <p className="mt-6 max-w-xl text-lg text-mist">Tell us about yourself. We verify every technician before they receive jobs, so your National ID and a clear photo are required.</p>
      {error && <p className="mt-6 rounded-2xl bg-danger/10 px-4 py-3 text-danger" role="alert">{error}</p>}

      <form onSubmit={submit} className="mt-10 space-y-6" noValidate>
        <Section title="Your account">
          {text('fullName', 'Full name, as on your National ID', { autoComplete: 'name', required: true })}
          <div className="grid gap-4 sm:grid-cols-2">
            {text('phone', 'Phone number', { type: 'tel', placeholder: '0700 000 000', autoComplete: 'tel', required: true }, 'Customers and FixPro will call this number.')}
            {text('email', 'Email (optional)', { type: 'email', autoComplete: 'email' })}
          </div>
          {text('password', 'Password', { type: 'password', autoComplete: 'new-password', required: true }, 'At least 8 characters, with a letter and a number.')}
        </Section>

        <Section title="Identity" hint="Used only to verify who you are. Your NIN is stored encrypted and your ID photo is never shown to customers.">
          <div className="grid gap-4 sm:grid-cols-2">
            {text('nin', 'National ID Number (NIN)', { maxLength: 14, placeholder: '14 letters and numbers', style: { textTransform: 'uppercase' }, required: true })}
            {text('dateOfBirth', 'Date of birth', { type: 'date', required: true })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your photo" error={errors.photo} hint="A clear photo of your face. Customers see this.">
              <input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} required />
            </Field>
            <Field label="Photo of your National ID" error={errors.idDocument} hint="JPG, PNG or WebP, under 3 MB.">
              <input className="input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setIdDocument(e.target.files[0] || null)} required />
            </Field>
          </div>
          {preview && <img src={preview} alt="Your photo preview" className="h-24 w-24 rounded-full object-cover ring-2 ring-white/20" />}
        </Section>

        <Section title="Where you live and who to contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="District" error={errors.residenceDistrict}>
              <select className="input" value={form.residenceDistrict} onChange={set('residenceDistrict')}>{districts.map((d) => <option key={d}>{d}</option>)}</select>
            </Field>
            {text('residenceTown', 'Town')}
          </div>
          {text('residenceAddress', 'Home address or village', { required: true })}
          <div className="grid gap-4 sm:grid-cols-2">
            {text('nextOfKinName', 'Next of kin: full name', { required: true })}
            {text('nextOfKinPhone', 'Next of kin: phone', { type: 'tel', required: true })}
          </div>
        </Section>

        <Section title="Your work">
          <Field label="Your experience" error={errors.experienceSummary} hint="Years of experience, places you have worked, and what you are best at.">
            <textarea className="input min-h-28" value={form.experienceSummary} onChange={set('experienceSummary')} required />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">Areas you cover</p>
            <div className="flex flex-wrap gap-2">
              {districts.map((d) => (
                <label key={d} className={`cursor-pointer rounded-full border px-4 py-2 text-sm ${areas.includes(d) ? 'border-lime bg-lime/10' : 'border-white/15'}`}>
                  <input type="checkbox" className="sr-only" checked={areas.includes(d)} onChange={() => toggle(areas, setAreas, d)} />{d}
                </label>
              ))}
            </div>
            {errors.districts && <p className="mt-1 text-xs text-danger" role="alert">{errors.districts}</p>}
          </div>
          <div>
            <p className="mb-3 text-sm font-medium">What you can repair</p>
            <div className="space-y-4">
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <p className="mb-2 text-xs text-mist">{cat}</p>
                  <div className="flex flex-wrap gap-2">
                    {items.map((s) => (
                      <label key={s.id} className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-sm ${serviceIds.includes(s.id) ? 'border-lime bg-lime/10' : 'border-white/15'}`}>
                        <input type="checkbox" className="sr-only" checked={serviceIds.includes(s.id)} onChange={() => toggle(serviceIds, setServiceIds, s.id)} />{s.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {errors.serviceIds && <p className="mt-2 text-xs text-danger" role="alert">{errors.serviceIds}</p>}
          </div>
        </Section>

        <label className="flex items-start gap-3 text-sm text-mist">
          <input type="checkbox" className="mt-1 accent-lime" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I confirm the information above is true, and I agree that FixPro may check my National ID to verify my identity.{errors.consent && <span className="block text-xs text-danger">{errors.consent}</span>}</span>
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <button className="btn-primary !px-8 !py-4 !text-base" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
          <Link to="/login" className="text-sm text-mist hover:text-white">Already applied? Sign in</Link>
        </div>
      </form>
    </section>
  );
}
