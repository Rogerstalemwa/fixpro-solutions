import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Field, { fieldErrors } from '../components/Field.jsx';
import PrivateMedia from '../components/PrivateImage.jsx';
import { Reveal } from '../lib/motion.jsx';
import { formatDate } from '../lib/format.js';

const TYPES = ['Laptop', 'Desktop computer', 'Television', 'Phone', 'Tablet', 'Home appliance', 'CCTV or camera', 'Router or network device', 'UPS or inverter', 'Printer', 'Other'];
const blank = { category: 'Laptop', brand: '', model: '', serialNumber: '', purchaseDate: '', description: '', notes: '' };

// Registered devices (requirements 4.4): as many as needed, with photographs.
function DeviceForm({ device, onSaved, onCancel }) {
  const [f, setF] = useState(device ? { ...blank, ...Object.fromEntries(Object.entries(device).map(([k, v]) => [k, v == null ? '' : k === 'purchaseDate' ? String(v).slice(0, 10) : v])) } : blank);
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    try {
      const body = Object.fromEntries(Object.entries({ category: f.category, brand: f.brand, model: f.model, serialNumber: f.serialNumber, purchaseDate: f.purchaseDate, description: f.description, notes: f.notes }).filter(([, v]) => v !== ''));
      const saved = device ? (await api(`/customers/me/devices/${device.id}`, { method: 'PATCH', body })).data : (await api('/customers/me/devices', { method: 'POST', body })).data;
      if (files.length) { const fd = new FormData(); files.forEach((file) => fd.append('photos', file)); await api(`/customers/me/devices/${saved.id}/photos`, { method: 'POST', body: fd }); }
      onSaved();
    } catch (err) { setErrors(fieldErrors(err)); setError(err.errors?.length ? 'Please check the highlighted fields.' : err.message); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="glass space-y-4 rounded-3xl p-6" noValidate>
      <h2 className="font-display text-xl font-bold">{device ? 'Edit device' : 'Add a device'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Device type" error={errors.category}><select className="input" value={f.category} onChange={set('category')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Manufacturer" error={errors.brand}><input className="input" placeholder="HP, Samsung, Tecno…" value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Model" error={errors.model}><input className="input" value={f.model} onChange={set('model')} /></Field>
        <Field label="Serial number" error={errors.serialNumber} hint="If you can find it."><input className="input" value={f.serialNumber} onChange={set('serialNumber')} /></Field>
        <Field label="Purchase date" error={errors.purchaseDate} hint="If you know it."><input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={f.purchaseDate} onChange={set('purchaseDate')} /></Field>
      </div>
      <Field label="Description" error={errors.description}><input className="input" value={f.description} onChange={set('description')} /></Field>
      <Field label="Notes" error={errors.notes} hint="Anything a technician should know, such as past repairs."><textarea className="input min-h-20" value={f.notes} onChange={set('notes')} /></Field>
      <Field label="Photos" error={errors.photos} hint="Up to 6 photos in total, JPG, PNG or WebP.">
        <input className="input" type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files].slice(0, 4))} />
      </Field>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex gap-3"><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save device'}</button><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function Devices() {
  const [devices, setDevices] = useState(null);
  const [editing, setEditing] = useState(null); // null, 'new' or a device
  const [error, setError] = useState('');
  const load = useCallback(() => { api('/customers/me/devices').then(({ data }) => setDevices(data)).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  const done = () => { setEditing(null); load(); };
  const remove = async (d) => { if (window.confirm(`Remove ${d.brand || ''} ${d.model || d.category}?`)) { await api(`/customers/me/devices/${d.id}`, { method: 'DELETE' }).catch((e) => setError(e.message)); load(); } };
  const removePhoto = async (d, photo) => { await api(`/customers/me/devices/${d.id}/photos/${photo.id}`, { method: 'DELETE' }).catch((e) => setError(e.message)); load(); };

  return (
    <section className="mx-auto max-w-5xl px-5 pb-10 pt-14 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6"><h1 className="giant-md">My devices</h1>{!editing && <button className="btn-primary !px-7 !py-3.5" onClick={() => setEditing('new')}>Add a device</button>}</div>
      {error && <p className="mt-6 text-danger" role="alert">{error}</p>}
      {editing && <div className="mt-10"><DeviceForm device={editing === 'new' ? null : editing} onSaved={done} onCancel={() => setEditing(null)} /></div>}
      {devices && !devices.length && !editing && <div className="glass mt-10 rounded-3xl p-10 text-center"><p className="font-display text-2xl font-bold">No devices yet</p><p className="mt-2 text-mist">Register your laptop, TV, phone or appliance so booking a repair takes seconds.</p></div>}
      <ul className="mt-10 grid gap-4 md:grid-cols-2">
        {devices?.map((d, i) => (
          <Reveal as="li" key={d.id} delay={i * 50} className="glass rounded-3xl p-5">
            <p className="font-display text-xl font-bold">{[d.brand, d.model].filter(Boolean).join(' ') || d.category}</p>
            <p className="text-sm text-mist">{d.category}{d.serialNumber ? ` · SN ${d.serialNumber}` : ''}{d.purchaseDate ? ` · bought ${formatDate(d.purchaseDate)}` : ''}</p>
            {d.description && <p className="mt-2 text-sm">{d.description}</p>}
            {d.notes && <p className="mt-1 text-sm text-mist">{d.notes}</p>}
            {d.photos.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {d.photos.map((p) => (
                  <div key={p.id} className="group relative"><PrivateMedia kind="device-photo" id={p.id} alt="Device" className="h-20 w-20 rounded-xl object-cover" />
                    <button className="absolute -right-1 -top-1 hidden h-6 w-6 rounded-full bg-navy-900 text-xs group-hover:block" onClick={() => removePhoto(d, p)} aria-label="Remove photo">×</button></div>
                ))}
              </div>
            )}
            <div className="mt-4 flex gap-3"><button className="btn-ghost !py-1.5" onClick={() => setEditing(d)}>Edit</button><button className="btn-ghost !py-1.5" onClick={() => remove(d)}>Remove</button></div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}
