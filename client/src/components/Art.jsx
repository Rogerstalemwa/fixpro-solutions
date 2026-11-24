// Original soft-3D illustrations and icons for FixPro. No external images: fast, crisp and offline-safe.

const LIME = '#BDF23D';
const MIST = '#9DB0D0';
const RIM = 'rgba(255,255,255,.18)';
const BODY = 'url(#fp-body)';
const SCREEN = 'url(#fp-screen)';
const LIMEG = 'url(#fp-lime)';
const SHEEN = 'url(#fp-sheen)';
const base = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

function Frame({ children, className = '' }) {
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="fp-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={LIME} stopOpacity="0.22" />
          <stop offset="100%" stopColor={LIME} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fp-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3F5DA6" />
          <stop offset="1" stopColor="#0F1F47" />
        </linearGradient>
        <linearGradient id="fp-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14284F" />
          <stop offset="1" stopColor="#06112A" />
        </linearGradient>
        <linearGradient id="fp-lime" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E6FF94" />
          <stop offset="1" stopColor="#9FD91E" />
        </linearGradient>
        <linearGradient id="fp-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".26" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="fp-blur" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <ellipse cx="100" cy="76" rx="88" ry="62" fill="url(#fp-glow)" />
      <ellipse cx="100" cy="137" rx="56" ry="6.5" fill="#000" opacity=".42" filter="url(#fp-blur)" />
      {children}
    </svg>
  );
}

const Laptop = (p) => (
  <Frame {...p}>
    <path d="M26 108h148l-10 13a6 6 0 0 1-5 2.5H41a6 6 0 0 1-5-2.5z" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <rect x="46" y="22" width="108" height="80" rx="10" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <rect x="53" y="29" width="94" height="66" rx="5" fill={SCREEN} />
    <path {...base} stroke={LIME} strokeWidth="3.5" d="M63 45h30M63 56h46M63 67h22" />
    <circle cx="127" cy="68" r="12" fill={LIMEG} />
    <path {...base} stroke="#0C1B3A" strokeWidth="3" d="M121.5 68l4 4 7-8" />
    <rect x="53" y="29" width="94" height="24" rx="5" fill={SHEEN} />
    <path {...base} stroke={RIM} strokeWidth="2" d="M88 114h24" />
  </Frame>
);

const Tv = (p) => (
  <Frame {...p}>
    <rect x="26" y="22" width="148" height="90" rx="12" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <rect x="34" y="30" width="132" height="74" rx="6" fill={SCREEN} />
    <path {...base} stroke={MIST} strokeWidth="3" d="M52 90l26-26 18 16 24-32 22 24" />
    <circle cx="146" cy="52" r="7" fill={LIMEG} />
    <rect x="34" y="30" width="132" height="28" rx="6" fill={SHEEN} />
    <path d="M84 112l-9 14h50l-9-14z" fill={BODY} stroke={RIM} strokeWidth="1.5" strokeLinejoin="round" />
    <rect x="62" y="124" width="76" height="7" rx="3.5" fill={BODY} stroke={RIM} strokeWidth="1.5" />
  </Frame>
);

const Phone = (p) => (
  <Frame {...p}>
    <rect x="70" y="10" width="60" height="118" rx="16" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <rect x="76" y="17" width="48" height="104" rx="11" fill={SCREEN} />
    <rect x="92" y="21" width="16" height="5" rx="2.5" fill="#050E22" />
    <rect x="84" y="48" width="32" height="18" rx="4.5" fill="none" stroke={MIST} strokeWidth="2" />
    <rect x="87" y="51" width="19" height="12" rx="2.5" fill={LIMEG} />
    <path {...base} stroke={MIST} strokeWidth="2.5" d="M84 86h32M84 97h20" />
    <rect x="76" y="17" width="48" height="42" rx="11" fill={SHEEN} />
    <path {...base} stroke={LIME} strokeWidth="2.5" d="M142 46l8-8M148 62h10M142 78l8 8" />
  </Frame>
);

const Appliance = (p) => (
  <Frame {...p}>
    <rect x="52" y="14" width="96" height="118" rx="12" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <path {...base} stroke={RIM} strokeWidth="2" d="M52 42h96" />
    <circle cx="69" cy="28" r="5" fill={LIMEG} />
    <circle cx="84" cy="28" r="5" fill="none" stroke={MIST} strokeWidth="2" />
    <rect x="112" y="23" width="26" height="10" rx="5" fill="#0A1838" />
    <circle cx="100" cy="88" r="33" fill="#0A1838" stroke={RIM} strokeWidth="2" />
    <circle cx="100" cy="88" r="24" fill={SCREEN} stroke={LIME} strokeWidth="3" />
    <path {...base} stroke={MIST} strokeWidth="2.5" d="M88 90c4-6 8 6 12 0s8 6 12 0" />
    <rect x="52" y="14" width="96" height="30" rx="12" fill={SHEEN} />
  </Frame>
);

const Cctv = (p) => (
  <Frame {...p}>
    <rect x="36" y="24" width="14" height="48" rx="4" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <path {...base} stroke="#2B4580" strokeWidth="6" d="M50 48h22" />
    <g transform="rotate(-8 100 66)">
      <rect x="62" y="46" width="88" height="40" rx="14" fill={BODY} stroke={RIM} strokeWidth="1.5" />
      <rect x="74" y="54" width="36" height="9" rx="4.5" fill="#0A1838" />
      <circle cx="136" cy="66" r="15" fill="#0A1838" stroke={LIME} strokeWidth="2.5" />
      <circle cx="136" cy="66" r="6" fill={LIMEG} />
      <rect x="62" y="46" width="88" height="18" rx="9" fill={SHEEN} />
    </g>
    <path {...base} stroke={LIME} strokeWidth="2.5" d="M160 50c9 7 9 27 0 34M169 42c14 12 14 38 0 50" />
    <path {...base} stroke="#2B4580" strokeWidth="2.5" d="M60 114h80M78 125h44" />
  </Frame>
);

const Router = (p) => (
  <Frame {...p}>
    <path {...base} stroke="#2B4580" strokeWidth="5" d="M62 88L50 42M138 88l12-46" />
    <circle cx="50" cy="40" r="5" fill={LIMEG} />
    <circle cx="150" cy="40" r="5" fill={LIMEG} />
    <rect x="34" y="84" width="132" height="42" rx="13" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <circle cx="62" cy="105" r="4.5" fill={LIMEG} />
    <circle cx="78" cy="105" r="4.5" fill={LIMEG} />
    <circle cx="94" cy="105" r="4.5" fill="none" stroke={MIST} strokeWidth="2" />
    <rect x="116" y="100" width="36" height="9" rx="4.5" fill="#0A1838" />
    <rect x="34" y="84" width="132" height="18" rx="9" fill={SHEEN} />
    <path {...base} stroke={LIME} strokeWidth="3" d="M80 62a28 28 0 0 1 40 0M88 71a16 16 0 0 1 24 0" />
    <circle cx="100" cy="79" r="2.8" fill={LIME} />
  </Frame>
);

const Ups = (p) => (
  <Frame {...p}>
    <rect x="58" y="16" width="84" height="114" rx="14" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <rect x="68" y="27" width="64" height="24" rx="6" fill="#0A1838" />
    <path {...base} stroke={LIME} strokeWidth="3.5" d="M77 39h8M92 39h8M107 39h8" />
    <circle cx="100" cy="88" r="26" fill={SCREEN} stroke={RIM} strokeWidth="2" />
    <path d="M105 70l-13 20h10l-5 15 14-21h-10z" fill={LIMEG} />
    <rect x="58" y="16" width="84" height="34" rx="14" fill={SHEEN} />
  </Frame>
);

const Generic = (p) => (
  <Frame {...p}>
    <circle cx="100" cy="76" r="36" fill={BODY} stroke={RIM} strokeWidth="1.5" />
    <circle cx="100" cy="76" r="13" fill={SCREEN} stroke={LIME} strokeWidth="3" />
    <path {...base} stroke={LIME} strokeWidth="4" d="M100 28v12M100 112v12M52 76h12M136 76h12M66 42l8 8M126 102l8 8M134 42l-8 8M74 102l-8 8" />
  </Frame>
);

// Exported so other pages can place a floating device.
export { Laptop, Phone, Tv };

const KINDS = [
  [/laptop|computer/i, 'laptop', Laptop, 'Computers', 'Slow, broken or not starting. Back to full speed.'],
  [/tele|entertain|\btv\b/i, 'tv', Tv, 'TVs and audio', 'Picture, sound and smart features restored.'],
  [/phone|tablet|mobile/i, 'phone', Phone, 'Phones and tablets', 'Screens, batteries, ports and software.'],
  [/appliance/i, 'appliance', Appliance, 'Appliances', 'Washing machines, microwaves, fridges and more.'],
  [/security|surveil|cctv/i, 'camera', Cctv, 'Security', 'Cameras and recorders, installed and fixed.'],
  [/network|wifi|connect/i, 'wifi', Router, 'Networking', 'Routers, Wi-Fi and office networks that just work.'],
  [/power|ups|inverter|accessor/i, 'power', Ups, 'Power', 'UPS, inverters, chargers and adapters.'],
];
const kindOf = (name = '') => KINDS.find(([re]) => re.test(name));

export const CategoryArt = ({ name, className }) => {
  const Art = kindOf(name)?.[2] || Generic;
  return <Art className={className} />;
};
export const iconKey = (name) => kindOf(name)?.[1] || 'grid';
export const shortName = (name) => kindOf(name)?.[3] || name;
export const blurb = (name) => kindOf(name)?.[4] || '';

const PATHS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  laptop: 'M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v8h-17V8A1.5 1.5 0 0 1 5 6.5zM2 19.5h20',
  tv: 'M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 21h8',
  phone: 'M9 2.5h6a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18h2',
  appliance: 'M7 2.5h10a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM5 7.5h14M12 11.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  camera: 'M3 8h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H3zM17 11.5l4-2v5l-4-2',
  wifi: 'M4.5 10a11 11 0 0 1 15 0M7.5 13.2a6.5 6.5 0 0 1 9 0M12 17.5h.01',
  power: 'M13 3L5 13h6l-1 8 8-10h-6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  shield: 'M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6zM9 12l2.2 2.2L15.5 10',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  pin: 'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11zM12 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  wrench: 'M14.5 6.5a4 4 0 0 0 5 5L9 22l-4-4zM14.5 6.5l3-3 3 3-3 3',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  x: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zM4 20.5c.6-3.8 3.6-6 8-6s7.4 2.2 8 6',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4',
  moon: 'M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15zM10 21h4',
  chevron: 'M6 9l6 6 6-6',
  box: 'M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5L12 12l8.5-4.5M12 12v9',
};

export function Icon({ name, className = 'h-5 w-5', strokeWidth = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] || PATHS.grid} />
    </svg>
  );
}
