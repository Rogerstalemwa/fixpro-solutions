import { useState } from 'react';
import Field, { fieldErrors } from './Field.jsx';

// A small form driven by a list of field definitions, used by the workshop, logistics and operations screens.
// field: { name, label, type: text | textarea | select | datetime | number | checkbox | bool | file, options, hint, required, show(values) }
// With `multipart`, the values are sent as FormData and any chosen files go in the `photos` part.
export default function MiniForm({ fields, submitLabel, onSubmit, multipart = false, initial = {}, compact = false }) {
  const blank = Object.fromEntries(fields.filter((f) => f.type !== 'file').map((f) => [f.name, f.type === 'checkbox' ? false : f.type === 'bool' ? 'true' : f.default ?? '']));
  const [v, setV] = useState({ ...blank, ...initial });
  const [files, setFiles] = useState([]);
  const [errs, setErrs] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (name) => (e) => setV({ ...v, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const visible = (f) => !f.show || f.show(v);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrs({});
    try {
      const active = fields.filter((f) => f.type !== 'file' && visible(f));
      let body;
      if (multipart) {
        body = new FormData();
        for (const f of active) {
          const value = v[f.name];
          if (f.type === 'checkbox') body.append(f.name, String(!!value));
          else if (value !== '' && value != null) body.append(f.name, String(value));
        }
        files.forEach((file) => body.append('photos', file));
      } else {
        body = {};
        for (const f of active) {
          const value = v[f.name];
          if (f.type === 'checkbox') body[f.name] = !!value;
          else if (f.type === 'bool') body[f.name] = value === 'true';
          else if (value !== '' && value != null) body[f.name] = value;
        }
      }
      await onSubmit(body);
    } catch (err) {
      setErrs(fieldErrors(err));
      setError(err.errors?.length ? '' : err.message);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className={`space-y-3 ${compact ? '' : 'rounded-2xl border border-white/10 p-4'}`} noValidate>
      {fields.filter(visible).map((f) => (
        <Field key={f.name} label={f.label} error={errs[f.name] || (f.type === 'file' ? errs.photos : undefined)} hint={f.hint}>
          {f.type === 'textarea' ? <textarea className="input min-h-20" value={v[f.name]} onChange={set(f.name)} /> :
            f.type === 'select' ? (
              <select className="input" value={v[f.name]} onChange={set(f.name)}>
                <option value="">{f.placeholder || 'Choose…'}</option>
                {f.options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
              </select>
            ) :
            f.type === 'bool' ? (
              <select className="input" value={v[f.name]} onChange={set(f.name)}>
                <option value="true">{f.yes || 'Yes'}</option><option value="false">{f.no || 'No'}</option>
              </select>
            ) :
            f.type === 'checkbox' ? (
              <span className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-lime" checked={!!v[f.name]} onChange={set(f.name)} />{f.checkLabel}</span>
            ) :
            f.type === 'file' ? (
              <input type="file" accept="image/*" multiple capture="environment" className="input" onChange={(e) => setFiles([...e.target.files].slice(0, f.max || 4))} />
            ) :
            <input className="input" type={f.type === 'datetime' ? 'datetime-local' : f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} value={v[f.name]} onChange={set(f.name)} />}
        </Field>
      ))}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}
