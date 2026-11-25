import { LOGO_PATH, LOGO_VIEWBOX } from '../lib/logoPath.js';

// The FixPro emblem. Lime on the dark theme, navy on the light theme.
export default function Logo({ className = 'h-10 w-10', title = 'FixPro Solutions' }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={`text-logo ${className}`} role="img" aria-label={title} fill="currentColor">
      <path fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}
