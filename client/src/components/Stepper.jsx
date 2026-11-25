import { Icon } from './Art.jsx';
import { STAGES } from '../lib/format.js';

// Horizontal progress through the six stages of a repair.
export default function Stepper({ stage, compact = false }) {
  if (stage < 0) return null;
  return (
    <ol className="flex items-start" aria-label="Progress">
      {STAGES.map((label, i) => {
        const done = i < stage;
        const current = i === stage;
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <span className={`absolute right-1/2 top-3 h-px w-full ${i <= stage ? 'bg-lime' : 'bg-white/15'}`} aria-hidden="true" />}
            <span className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border text-[10px] transition-colors ${done ? 'border-lime bg-lime text-ink' : current ? 'animate-pulse-ring border-lime bg-navy-900' : 'border-white/20 bg-navy-900'}`}>
              {done && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            {!compact && <span className={`mt-2 hidden text-[11px] leading-tight sm:block ${current ? 'font-semibold text-white' : done ? 'text-mist' : 'text-mist/50'}`}>{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}
