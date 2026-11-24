import { useTheme } from '../lib/theme.jsx';
import { Icon } from './Art.jsx';

export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();
  const light = theme === 'light';
  return (
    <button type="button" onClick={toggle} aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'} title={light ? 'Dark mode' : 'Light mode'}
      className={`grid h-9 w-9 place-items-center rounded-full text-mist transition-colors hover:bg-white/10 hover:text-white ${className}`}>
      <Icon name={light ? 'moon' : 'sun'} className="h-[18px] w-[18px]" />
    </button>
  );
}
