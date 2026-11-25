// Profile photo, or initials when there is no photo yet.
export default function Avatar({ name = '', src, className = 'h-12 w-12' }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  return src ? (
    <img src={src} alt={name} className={`${className} shrink-0 rounded-full object-cover ring-2 ring-white/15`} />
  ) : (
    <span className={`${className} grid shrink-0 place-items-center rounded-full bg-navy-700 font-display font-bold ring-2 ring-white/15`} aria-label={name}>{initials || '?'}</span>
  );
}
