import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext({ theme: 'dark', toggle: () => {} });
const current = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const saved = () => { try { return localStorage.getItem('fp-theme'); } catch { return null; } };

// Light and dark mode. Follows the device setting until the visitor picks one, then remembers the choice.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(current);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F3F6FC' : '#07122A');
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (!saved()) setTheme(mq.matches ? 'light' : 'dark'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    const root = document.documentElement;
    root.classList.add('theme-anim');
    setTimeout(() => root.classList.remove('theme-anim'), 450);
    try { localStorage.setItem('fp-theme', next); } catch { /* private mode: still switches for this visit */ }
    setTheme(next);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
