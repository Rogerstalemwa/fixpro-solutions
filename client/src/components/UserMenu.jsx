import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Art.jsx';

const roleLabel = (roles) =>
  roles.includes('SUPER_ADMIN') ? 'Administrator'
  : roles.some((r) => ['OPERATIONS_ADMIN', 'TECHNICAL_SUPERVISOR', 'FINANCE_ADMIN'].includes(r)) ? 'Operations'
  : roles.some((r) => r.endsWith('_TECHNICIAN')) ? 'Technician'
  : roles.includes('WORKSHOP_MANAGER') ? 'Workshop manager' : roles.includes('LOGISTICS_PERSONNEL') ? 'Collection and delivery' : 'Customer';

// Human icon and first name beside the nav, with a menu for the account.
export default function UserMenu({ user, homePath, homeLabel, badge, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-medium transition-colors hover:bg-white/10">
        <span className="relative grid h-8 w-8 place-items-center rounded-full bg-navy-700">
          <Icon name="user" className="h-[18px] w-[18px]" />
          {badge > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-lime ring-2 ring-navy-900" />}
        </span>
        <span className="max-w-[8rem] truncate">{user.fullName.split(' ')[0]}</span>
        <Icon name="chevron" className={`h-3.5 w-3.5 text-mist transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-[calc(100%+0.6rem)] z-50 w-64 animate-fade-up rounded-2xl bg-navy-900/95 p-2">
          <div className="border-b border-white/10 px-3 pb-3 pt-2">
            <p className="truncate font-semibold">{user.fullName}</p>
            <p className="truncate text-xs text-mist">{user.phone}</p>
            <span className="mt-2 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-xs">{roleLabel(user.roles)}</span>
          </div>
          <Link role="menuitem" to={homePath} onClick={() => setOpen(false)} className="mt-1 flex items-center justify-between rounded-xl px-3 py-2.5 text-sm hover:bg-white/10">
            {homeLabel}{badge > 0 && <span className="rounded-full bg-lime px-2 py-0.5 text-xs font-semibold text-ink">{badge}</span>}
          </Link>
          {user.roles.includes('CUSTOMER') && (
            <Link role="menuitem" to="/devices" onClick={() => setOpen(false)} className="flex items-center rounded-xl px-3 py-2.5 text-sm hover:bg-white/10">My devices</Link>
          )}
          <button role="menuitem" onClick={() => { setOpen(false); onSignOut(); }} className="w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/10">Sign out</button>
        </div>
      )}
    </div>
  );
}
