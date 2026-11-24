import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Icon } from './Art.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import UserMenu from './UserMenu.jsx';
import { useNotificationSummary } from '../lib/useSummary.js';

const TECH_ROLES = ['COMPANY_TECHNICIAN', 'INDEPENDENT_TECHNICIAN'];
const linkClass = ({ isActive }) => `rounded-full px-4 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-mist hover:text-white'}`;

export default function Layout() {
  const { user, isStaff, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

  const summary = useNotificationSummary(!!user, location.pathname);
  const isTech = !!user?.roles.some((r) => TECH_ROLES.includes(r));
  const [homePath, homeLabel] = isStaff ? ['/admin', 'Operations'] : isTech ? ['/technician', 'My jobs'] : ['/dashboard', 'My bookings'];
  const badge = isTech ? Math.max(summary.unread, summary.offers) : summary.unread;
  const signOut = async () => { await logout(); navigate('/'); };

  const links = (
    <>
      <NavLink to="/services" className={linkClass}>Services</NavLink>
      {user && (
        <NavLink to={homePath} className={linkClass}>
          {homeLabel}
          {badge > 0 && <span className="ml-2 inline-grid min-w-[1.25rem] place-items-center rounded-full bg-lime px-1.5 text-xs font-semibold text-ink" aria-label={`${badge} new`}>{badge}</span>}
        </NavLink>
      )}
    </>
  );
  const actions = user ? (
    <UserMenu user={user} homePath={homePath} homeLabel={homeLabel} badge={badge} onSignOut={signOut} />
  ) : (
    <>
      <NavLink to="/login" className={linkClass}>Sign in</NavLink>
      <Link to="/register" className="btn-primary !py-2">Get started</Link>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-3 sm:pt-4">
        <div className={`glass flex w-full max-w-3xl items-center justify-between gap-2 rounded-full py-2 pl-4 pr-2 transition-all duration-300 ${scrolled ? 'bg-navy-900/80 shadow-2xl shadow-black/50' : ''}`}>
          <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-extrabold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"><Icon name="wrench" className="h-4 w-4" strokeWidth={2.2} /></span>
            FixPro
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">{links}</nav>
          <div className="hidden items-center gap-1 md:flex"><ThemeToggle />{actions}</div>
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <button className="btn-ghost !px-3 !py-2" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
              <Icon name={open ? 'x' : 'menu'} />
            </button>
          </div>
        </div>
        {open && (
          <div className="glass absolute left-3 right-3 top-[4.5rem] flex animate-fade-up flex-col gap-1 rounded-3xl bg-navy-900/90 p-3 md:hidden">
            {links}
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-3">
              {user ? (
                <>
                  <p className="flex items-center gap-3 px-2 text-sm"><span className="grid h-9 w-9 place-items-center rounded-full bg-navy-700"><Icon name="user" className="h-5 w-5" /></span><span className="min-w-0"><span className="block truncate font-semibold">{user.fullName}</span><span className="block truncate text-xs text-mist">{user.phone}</span></span></p>
                  <button className="btn-ghost" onClick={signOut}>Sign out</button>
                </>
              ) : actions}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 pt-20">
        <div key={location.pathname} className="animate-page-in"><Outlet /></div>
      </main>

      <footer className="relative mt-32 overflow-hidden border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 pb-6 pt-16 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <p className="max-w-sm font-display text-2xl font-bold leading-tight tracking-tight">On-demand electronics repair, at your door in Kampala, Wakiso and Mukono.</p>
          <ul className="space-y-2 text-sm text-mist">
            <li><Link className="hover:text-white" to="/services">Services</Link></li>
            <li><Link className="hover:text-white" to="/register">Create an account</Link></li>
            <li><Link className="hover:text-white" to="/register/technician">Become a technician</Link></li>
            <li><Link className="hover:text-white" to="/login">Sign in</Link></li>
          </ul>
          <ul className="space-y-2 text-sm text-mist">
            <li>Kampala</li><li>Wakiso</li><li>Mukono</li>
          </ul>
        </div>
        <p aria-hidden="true" className="select-none whitespace-nowrap text-center font-display font-extrabold leading-[.78] tracking-[-.06em] text-white/[.06]" style={{ fontSize: '23vw', marginBottom: '-2.2vw' }}>FIXPRO</p>
        <p className="absolute bottom-3 left-5 text-xs text-mist sm:left-8">© {new Date().getFullYear()} FixPro Solutions</p>
      </footer>
    </div>
  );
}
