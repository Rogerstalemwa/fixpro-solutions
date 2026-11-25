import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import Field, { fieldErrors } from '../components/Field.jsx';

const DEVICE_TYPES = ['Laptop', 'Desktop computer', 'Television', 'Phone', 'Tablet', 'Home appliance', 'CCTV or camera', 'Router or network device', 'UPS or inverter', 'Other'];
const FULFILMENT = [
  ['DOORSTEP', 'At my location', 'A technician comes to you.'],
  ['WORKSHOP', 'At the workshop', 'You bring the device in.'],
  ['COLLECTION_DELIVERY', 'Collect and deliver', 'We collect it and bring it back.'],
];
const NEW = 'new';
const blankDevice = { category: 'Laptop', brand: '', model: '', description: '' };
const blankAddress = { district: '', town: '', area: '', landmark: '' };

export default function Book() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [services, setServices] = useState([]);
  const [devices, setDevices] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [ready, setReady] = useState(false);

  const [deviceId, setDeviceId] = useState(NEW);
  const [device, setDevice] = useState(blankDevice);
  const [addressId, setAddressId] = useState(NEW);
  const [address, setAddress] = useState(blankAddress);
  const [serviceId, setServiceId] = useState(params.get('serviceId') || '');
  const [fulfilmentMethod, setFulfilmentMethod] = useState('DOORSTEP');
  const [faultDescription, setFault] = useState('');
  const [preferredDate, setDate] = useState('');
  const [preferredTime, setTime] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api('/services'), api('/customers/me/devices'), api('/customers/me/addresses'), api('/service-areas')])
      .then(([s, d, a, z]) => {
        setServices(s.data); setServiceId((cur) => (s.data.some((x) => x.id === cur) ? cur : '')); setDevices(d.data); setAddresses(a.data); setDistricts(z.data);
        if (d.data[0]) setDeviceId(d.data[0].id);
        if (a.data[0]) setAddressId(a.data[0].id);
        setAddress((cur) => ({ ...cur, district: z.data[0] || '' }));
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
      const dId = deviceId === NEW ? (await api('/customers/me/devices', { method: 'POST', body: clean(device) })).data.id : deviceId;
      const aId = addressId === NEW ? (await api('/customers/me/addresses', { method: 'POST', body: clean(address) })).data.id : addressId;
      await api('/bookings', {
        method: 'POST',
        body: { deviceId: dId, addressId: aId, serviceId, fulfilmentMethod, faultDescription, ...(preferredDate && { preferredDate }), ...(preferredTime && { preferredTime }) },
      });
      navigate('/dashboard');
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <p className="mx-auto max-w-6xl px-5 py-16 text-mist">Loading…</p>;
  const today = new Date().toISOString().slice(0, 10);
  const grouped = services.reduce((acc, s) => { (acc[s.category.name] ||= []).push(s); return acc; }, {});
  const sectionTitle = 'font-display text-lg font-bold';

  return (
    <section className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="giant-md">Book a repair</h1>
      <form onSubmit={submit} className="mt-8 space-y-8">
        <fieldset className="card space-y-4 p-6">
          <legend className={`${sectionTitle} px-1`}>Your device</legend>
          {devices.length > 0 && (
            <Field label="Device">
              <select className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => <option key={d.id} value={d.id}>{[d.brand, d.model, d.category].filter(Boolean).join(' ')}</option>)}
                <option value={NEW}>Add a new device</option>
              </select>
            </Field>
          )}
          {deviceId === NEW && (
            <>
              <Field label="Device type" error={errors.category}>
                <select className="input" value={device.category} onChange={(e) => setDevice({ ...device, category: e.target.value })}>
                  {DEVICE_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Brand"><input className="input" placeholder="HP, Samsung…" value={device.brand} onChange={(e) => setDevice({ ...device, brand: e.target.value })} /></Field>
                <Field label="Model"><input className="input" value={device.model} onChange={(e) => setDevice({ ...device, model: e.target.value })} /></Field>
              </div>
            </>
          )}
        </fieldset>

        <fieldset className="card space-y-4 p-6">
          <legend className={`${sectionTitle} px-1`}>What needs fixing</legend>
          <Field label="Service" error={errors.serviceId}>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              <option value="" disabled>Choose a service</option>
              {Object.entries(grouped).map(([cat, items]) => (
                <optgroup key={cat} label={cat}>{items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
              ))}
            </select>
          </Field>
          <Field label="Describe the problem" error={errors.faultDescription} hint="What happens, and when did it start?">
            <textarea className="input min-h-28" value={faultDescription} onChange={(e) => setFault(e.target.value)} required minLength={10} />
          </Field>
        </fieldset>

        <fieldset className="card space-y-4 p-6">
          <legend className={`${sectionTitle} px-1`}>Where and when</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {FULFILMENT.map(([value, title, text]) => (
              <label key={value} className={`cursor-pointer rounded-lg border p-3 text-sm ${fulfilmentMethod === value ? 'border-lime bg-lime/10' : 'border-navy-600'}`}>
                <input type="radio" name="fulfilment" className="sr-only" checked={fulfilmentMethod === value} onChange={() => setFulfilmentMethod(value)} />
                <span className="block font-semibold">{title}</span>
                <span className="text-mist">{text}</span>
              </label>
            ))}
          </div>
          {addresses.length > 0 && (
            <Field label="Address">
              <select className="input" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                {addresses.map((a) => <option key={a.id} value={a.id}>{[a.landmark, a.area, a.town, a.district].filter(Boolean).join(', ')}</option>)}
                <option value={NEW}>Add a new address</option>
              </select>
            </Field>
          )}
          {addressId === NEW && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="District" error={errors.district}>
                <select className="input" value={address.district} onChange={(e) => setAddress({ ...address, district: e.target.value })} required>
                  {districts.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Town"><input className="input" value={address.town} onChange={(e) => setAddress({ ...address, town: e.target.value })} /></Field>
              <Field label="Area or village"><input className="input" value={address.area} onChange={(e) => setAddress({ ...address, area: e.target.value })} /></Field>
              <Field label="Landmark"><input className="input" placeholder="Near…" value={address.landmark} onChange={(e) => setAddress({ ...address, landmark: e.target.value })} /></Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred date" error={errors.preferredDate}><input className="input" type="date" min={today} value={preferredDate} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Preferred time">
              <select className="input" value={preferredTime} onChange={(e) => setTime(e.target.value)}>
                <option value="">Any time</option>
                <option>09:00-12:00</option>
                <option>12:00-15:00</option>
                <option>15:00-18:00</option>
              </select>
            </Field>
          </div>
        </fieldset>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex items-center gap-4">
          <button className="btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit booking'}</button>
          <Link to="/dashboard" className="text-sm text-mist hover:text-accent">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
