import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { CategoryArt, Icon, Laptop, Phone, blurb, shortName } from '../components/Art.jsx';
import { Line, Marquee, Reveal, Tilt, useReducedMotion } from '../lib/motion.jsx';

const FALLBACK = ['Computers and laptops', 'Televisions and home entertainment', 'Mobile phones and tablets', 'Household electronic appliances', 'Security and surveillance', 'Networking and connectivity', 'Power and accessories'];
const SPAN = ['col-span-2 row-span-2', '', '', 'col-span-2', '', '', 'col-span-2'];

// Mirrors the real booking and job statuses a customer sees.
const TRACK = [
  ['Request received', 'Booking logged with FixPro'],
  ['Technician assigned', 'A verified technician accepts'],
  ['Appointment confirmed', 'Tuesday, 9:00 to 12:00'],
  ['Inspection and quote', 'Waiting for your approval'],
  ['Repair', 'Starts only after you approve'],
  ['Handover and warranty', 'Pay, collect and keep your warranty'],
];

const STEPS = [
  ['Book online', 'Pick your device, describe the fault, and choose a time and place.'],
  ['We assign a verified technician', 'Operations matches your job to someone who covers your area and knows your device.'],
  ['Inspection and quote', 'The technician diagnoses the fault. You see parts and labour separately.'],
  ['Repair where it suits you', 'At your door or in our workshop. Every handover of your device is recorded.'],
  ['Pay and keep your warranty', 'Pay after you approve. Completed repairs come with a warranty.'],
];

const WHY = [
  ['shield', 'Verified technicians', 'Every technician is checked before they can accept a job.'],
  ['receipt', 'Quote before repair', 'See parts and labour separately. Nothing starts until you approve.'],
  ['route', 'Tracked end to end', 'Follow your booking from request to handover.'],
  ['box', 'Device custody on record', 'Each handover of your device is logged, at home or in the workshop.'],
];

function LiveTracker() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(reduced ? 3 : 0);
  useEffect(() => {
    if (reduced) { setStep(3); return undefined; }
    const id = setInterval(() => setStep((s) => (s + 1) % (TRACK.length + 2)), 1900);
    return () => clearInterval(id);
  }, [reduced]);
  const active = Math.min(step, TRACK.length);

  return (
    <div className="glass rounded-3xl p-6" aria-label="Example of a booking being tracked">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="font-display text-lg font-bold tracking-tight">Laptop shows no display</p>
          <p className="text-sm text-mist">FPS-2026-4K7Q2M · Example booking</p>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-mist"><span className="h-1.5 w-1.5 rounded-full bg-lime" />Live</span>
      </div>
      <ol className="mt-5">
        {TRACK.map(([title, note], i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={title} className="relative flex gap-4 pb-5 last:pb-0">
              {i < TRACK.length - 1 && (
                <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-white/10" aria-hidden="true">
                  <span className="block w-px bg-lime transition-all duration-700" style={{ height: done ? '100%' : '0%' }} />
                </span>
              )}
              <span className={`relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-all duration-500 ${done ? 'border-lime bg-lime text-ink' : current ? 'animate-pulse-ring border-lime bg-navy-900' : 'border-white/20 bg-navy-900'}`}>
                {done && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <div className={`transition-opacity duration-500 ${i > active ? 'opacity-40' : 'opacity-100'}`}>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-sm text-mist">{note}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [categories, setCategories] = useState(FALLBACK);

  useEffect(() => {
    api('/service-categories')
      .then(({ data }) => {
        if (!data.length) return;
        const names = data.map((c) => c.name);
        setCategories([...FALLBACK.filter((n) => names.includes(n)), ...names.filter((n) => !FALLBACK.includes(n))]);
      })
      .catch(() => {});
  }, []);

  const spotlight = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const bookTo = user ? '/book' : '/register';
  const wrap = 'mx-auto max-w-7xl px-5 sm:px-8';

  return (
    <>
      {/* Hero: giant type, one accent, empty space */}
      <section className="hero-glow relative overflow-hidden" onMouseMove={spotlight}>
        <div className="bg-grid absolute inset-0" aria-hidden="true" />
        <div className={`${wrap} relative pb-28 pt-20 sm:pt-28`}>
          <div className="pointer-events-none absolute right-6 top-8 hidden w-[26rem] lg:block" aria-hidden="true">
            <Tilt max={10} className="pointer-events-auto animate-float"><Laptop className="w-full drop-shadow-2xl" /></Tilt>
            <div className="absolute -bottom-24 -left-10 w-40 animate-float [animation-delay:1.5s]"><Phone className="w-full drop-shadow-2xl" /></div>
          </div>

          <p className="glass inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-sm text-mist">
            <span className="h-2 w-2 animate-pulse-ring rounded-full bg-lime" />
            Kampala · Wakiso · Mukono
          </p>
          <h1 className="giant relative mt-8">
            <Line>Electronics</Line>
            <Line delay={110}>fixed where</Line>
            <Line delay={220}>you <span className="accent">are.</span></Line>
          </h1>

          <div className="mt-16 grid items-end gap-14 lg:grid-cols-[1fr_25rem]">
            <div>
              <Reveal delay={500}><p className="max-w-lg text-lg leading-relaxed text-mist">Book a verified technician for your laptop, TV, phone, appliance, CCTV or network. No queues, no carrying equipment across town.</p></Reveal>
              <Reveal delay={620} className="mt-9 flex flex-wrap gap-3">
                <Link to={bookTo} className="btn-primary !px-7 !py-3.5 !text-base">Book a repair</Link>
                <Link to="/services" className="btn-ghost glass !px-7 !py-3.5 !text-base">See what we fix</Link>
              </Reveal>
              <Reveal delay={740}>
                <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm text-mist">
                  {['Verified technicians', 'Quote before any repair', 'Tracked from booking to handover'].map((t) => (
                    <li key={t} className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-white" strokeWidth={2.4} />{t}</li>
                  ))}
                </ul>
              </Reveal>
            </div>
            <Reveal delay={600}><LiveTracker /></Reveal>
          </div>
        </div>
      </section>

      {/* Giant marquee */}
      <section className="border-y border-white/10 py-8" aria-label="What we repair">
        <Marquee>
          {[...categories, ...categories].map((name, i) => (
            <span key={`${name}-${i}`} className="flex items-center gap-8 pr-8 font-display text-6xl font-extrabold tracking-tighter sm:text-8xl">
              <span className="outline-text">{shortName(name)}</span>
              <span className="h-3 w-3 shrink-0 rounded-full bg-lime" />
            </span>
          ))}
        </Marquee>
      </section>

      {/* Bento: what we fix */}
      <section className={`${wrap} pt-36`}>
        <Reveal><h2 className="giant-md max-w-4xl">Everything with a <span className="accent">plug.</span></h2></Reveal>
        <div className="mt-16 grid auto-rows-[210px] grid-cols-2 gap-4 lg:grid-cols-4">
          {categories.map((name, i) => {
            const big = i === 0;
            return (
              <Reveal key={name} delay={i * 70} className={SPAN[i] || ''}>
                <Tilt max={5} className="spot h-full rounded-3xl">
                  <Link to={`/services?category=${encodeURIComponent(name)}`} className="glass group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl p-6">
                    <div className="relative z-10">
                      <h3 className={`font-display font-bold tracking-tight ${big ? 'text-3xl sm:text-4xl' : 'text-xl'}`}>{shortName(name)}</h3>
                      <p className={`mt-2 text-sm text-mist ${big ? 'max-w-[15rem]' : 'max-w-[11rem]'}`}>{blurb(name)}</p>
                    </div>
                    <span className="relative z-10 grid h-10 w-10 place-items-center rounded-full border border-white/20 transition-all duration-300 group-hover:border-lime group-hover:bg-lime group-hover:text-ink">
                      <Icon name="arrow" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </span>
                    <CategoryArt name={name} className={`pointer-events-none absolute -bottom-3 -right-3 transition-transform duration-500 group-hover:-rotate-3 group-hover:scale-110 ${big ? 'w-[78%] max-w-[26rem]' : 'w-[58%] max-w-[13rem]'}`} />
                  </Link>
                </Tilt>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className={`${wrap} pt-44`}>
        <Reveal><h2 className="giant-md max-w-4xl">Five steps. No surprises.</h2></Reveal>
        <ol className="mt-16">
          {STEPS.map(([title, text], i) => (
            <Reveal as="li" key={title} delay={i * 60} className="group grid grid-cols-[auto_1fr] items-baseline gap-x-8 gap-y-3 border-t border-white/10 py-9 md:grid-cols-[9rem_1fr_1fr]">
              <span className="outline-text font-display text-6xl font-extrabold tracking-tighter md:text-8xl">0{i + 1}</span>
              <h3 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{title}</h3>
              <p className="col-span-2 max-w-md text-mist md:col-span-1">{text}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Why FixPro */}
      <section className={`${wrap} pt-44`}>
        <Reveal><h2 className="giant-md max-w-4xl">Built to be <span className="accent">trusted.</span></h2></Reveal>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map(([icon, title, text], i) => (
            <Reveal key={title} delay={i * 80}>
              <Tilt max={4} className="spot glass h-full rounded-3xl p-7">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/5"><Icon name={icon} className="h-6 w-6" /></span>
                <h3 className="mt-14 font-display text-xl font-bold tracking-tight">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist">{text}</p>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className={`${wrap} pt-44`}>
        <Reveal>
          <div className="glass relative overflow-hidden rounded-[2.5rem] px-8 py-20 sm:px-16 sm:py-28">
            <div className="hero-glow absolute inset-0 opacity-70" aria-hidden="true" />
            <h2 className="giant-md relative max-w-3xl">Something not working?</h2>
            <p className="relative mt-6 max-w-md text-lg text-mist">Create an account, add your device, and book in a few minutes.</p>
            <div className="relative mt-10 flex flex-wrap items-center gap-4">
              <Link to={bookTo} className="btn-primary !px-8 !py-4 !text-base">Book a repair</Link>
              <span className="text-sm text-mist">Kampala · Wakiso · Mukono</span>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
