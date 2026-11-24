import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { CategoryArt, Icon, iconKey, shortName } from '../components/Art.jsx';
import { Line, Reveal, Tilt, useCountUp } from '../lib/motion.jsx';
import { ugx } from '../lib/format.js';

const NEXT = [
  'A verified technician is assigned to your job.',
  'They diagnose the fault, at your door or in our workshop.',
  'You get a written quote and approve it before any repair.',
  'We repair it, you pay, and the work is covered by a warranty.',
];

function ServiceCard({ service, index, onSelect }) {
  return (
    <Reveal delay={Math.min(index, 8) * 55} className="h-full">
      <Tilt max={5} className="spot h-full rounded-3xl">
        <button onClick={() => onSelect(service)} className="glass group flex h-full w-full flex-col overflow-hidden rounded-3xl text-left">
          <div className="relative grid h-44 place-items-center overflow-hidden bg-gradient-to-b from-white/[.06] to-transparent">
            <CategoryArt name={service.category.name} className="h-40 w-auto transition-transform duration-500 group-hover:-rotate-2 group-hover:scale-110" />
            <span className="absolute left-4 top-4 rounded-full bg-white/10 px-3 py-1 text-xs text-mist backdrop-blur">{shortName(service.category.name)}</span>
          </div>
          <div className="flex flex-1 flex-col p-6">
            <h3 className="font-display text-xl font-bold leading-tight tracking-tight">{service.name}</h3>
            {service.description && <p className="mt-2 line-clamp-2 text-sm text-mist">{service.description}</p>}
            <span className="mt-6 inline-flex items-center gap-3 pt-1 text-sm font-semibold">
              <span className="grid h-9 w-9 place-items-center rounded-full border border-white/20 transition-all duration-300 group-hover:border-lime group-hover:bg-lime group-hover:text-ink">
                <Icon name="arrow" className="h-4 w-4" />
              </span>
              Select this service
            </span>
          </div>
        </button>
      </Tilt>
    </Reveal>
  );
}

// The price appears here, only after a service is chosen.
function Drawer({ service, onClose }) {
  const fee = useCountUp(Number(service.diagnosticFee || 0));
  const panel = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="svc-title">
      <div className="absolute inset-0 animate-fade-in bg-navy-950/70 backdrop-blur-sm" onClick={onClose} />
      <aside ref={panel} tabIndex={-1} className="glass-strong absolute right-0 top-0 h-full w-full max-w-md animate-slide-in overflow-y-auto outline-none">
        <button onClick={onClose} className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close"><Icon name="x" /></button>
        <div className="grid h-64 place-items-center bg-gradient-to-b from-white/[.08] to-transparent">
          <CategoryArt name={service.category.name} className="h-56 w-auto animate-float" />
        </div>
        <div className="px-7 pb-10">
          <p className="text-sm text-mist">{service.category.name}</p>
          <h2 id="svc-title" className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight">{service.name}</h2>
          {service.description && <p className="mt-4 leading-relaxed text-mist">{service.description}</p>}

          {service.diagnosticFee != null && (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-mist">Diagnostic fee</p>
              <p className="mt-1 font-display text-4xl font-extrabold tracking-tight">{ugx(fee)}</p>
              <p className="mt-2 text-sm text-mist">Covers the inspection. The repair is quoted after diagnosis and starts only when you approve.</p>
            </div>
          )}

          <h3 className="mt-9 font-display text-lg font-bold">What happens next</h3>
          <ol className="mt-4 space-y-4">
            {NEXT.map((t, i) => (
              <li key={t} className="flex gap-4 text-sm text-mist">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/20 text-xs text-white">{i + 1}</span>{t}
              </li>
            ))}
          </ol>

          <Link to={`/book?serviceId=${service.id}`} className="btn-primary mt-10 w-full !py-4 !text-base">Book this service</Link>
          <button onClick={onClose} className="btn-ghost mt-3 w-full">Keep browsing</button>
        </div>
      </aside>
    </div>,
    document.body
  );
}

export default function Services() {
  const [params, setParams] = useSearchParams();
  const [services, setServices] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const tabs = useRef(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  const active = params.get('category') || 'all';

  useEffect(() => { api('/services').then(({ data }) => setServices(data)).catch((e) => setError(e.message)); }, []);

  const categories = useMemo(() => [...new Set((services || []).map((s) => s.category.name))], [services]);
  const counts = useMemo(() => (services || []).reduce((a, s) => ({ ...a, [s.category.name]: (a[s.category.name] || 0) + 1 }), {}), [services]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (services || []).filter((s) =>
      (active === 'all' || s.category.name === active) &&
      (!q || `${s.name} ${s.description || ''} ${s.category.name}`.toLowerCase().includes(q)));
  }, [services, active, query]);

  const measure = useCallback(() => {
    const el = tabs.current?.querySelector('[aria-selected="true"]');
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth });
  }, []);
  useLayoutEffect(measure, [active, services, measure]);
  useEffect(() => { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }, [measure]);

  const choose = (name, el) => {
    setParams(name === 'all' ? {} : { category: name }, { replace: true });
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };
  const closeDrawer = useCallback(() => setSelected(null), []);
  const tabClass = (on) => `relative z-10 flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${on ? 'text-navy-950' : 'text-mist hover:text-white'}`;

  return (
    <section className="mx-auto max-w-7xl px-5 pb-10 pt-16 sm:px-8 sm:pt-24">
      <h1 className="giant-md max-w-4xl">
        <Line>What can</Line>
        <Line delay={110}>we <span className="accent">fix?</span></Line>
      </h1>
      <Reveal delay={350}><p className="mt-8 max-w-xl text-lg text-mist">Choose a service to see what is involved. Each visit starts with a diagnosis, and you approve a written quote before any repair begins.</p></Reveal>

      <Reveal delay={450} className="mt-14">
        <label className="glass flex max-w-xl items-center gap-3 rounded-full px-5 py-3.5 focus-within:border-lime/60">
          <Icon name="search" className="h-5 w-5 text-mist" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a device or a fault, like screen or Wi-Fi" className="w-full bg-transparent text-base outline-none placeholder:text-mist/60" aria-label="Search services" />
          {query && <button type="button" onClick={() => setQuery('')} className="text-mist hover:text-white" aria-label="Clear search"><Icon name="x" className="h-4 w-4" /></button>}
        </label>
      </Reveal>

      <div className="sticky top-[4.75rem] z-30 mt-10 -mx-1 px-1">
        <div className="glass relative rounded-full">
          <div ref={tabs} role="tablist" aria-label="Service categories" className="scrollbar-none relative flex gap-1 overflow-x-auto p-1.5">
            <span aria-hidden="true" className="absolute bottom-1.5 left-0 top-1.5 rounded-full bg-paper shadow-lg transition-all duration-300 ease-out" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />
            <button role="tab" aria-selected={active === 'all'} onClick={(e) => choose('all', e.currentTarget)} className={tabClass(active === 'all')}>
              <Icon name="grid" className="h-4 w-4" />All<span className="text-xs opacity-60">{services?.length ?? ''}</span>
            </button>
            {categories.map((name) => (
              <button key={name} role="tab" aria-selected={active === name} onClick={(e) => choose(name, e.currentTarget)} className={tabClass(active === name)}>
                <Icon name={iconKey(name)} className="h-4 w-4" />{shortName(name)}<span className="text-xs opacity-60">{counts[name]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mt-12 text-danger" role="alert">{error}</p>}
      {!services && !error && <p className="mt-12 text-mist">Loading services…</p>}
      {services && !visible.length && (
        <div className="glass mt-12 rounded-3xl p-10 text-center">
          <p className="font-display text-2xl font-bold">Nothing matches that yet</p>
          <p className="mt-2 text-mist">Try a different word, or browse all services.</p>
          <button className="btn-ghost mt-6" onClick={() => { setQuery(''); choose('all'); }}>Show all services</button>
        </div>
      )}
      <div key={`${active}|${query}`} className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s, i) => <ServiceCard key={s.id} service={s} index={i} onSelect={setSelected} />)}
      </div>

      {selected && <Drawer service={selected} onClose={closeDrawer} />}
    </section>
  );
}
