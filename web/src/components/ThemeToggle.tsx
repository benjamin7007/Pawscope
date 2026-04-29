import { useEffect, useState } from 'react';
import { useT } from '../i18n';

type Theme = 'dark' | 'light';
const KEY = 'pawscope.theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') root.classList.add('theme-light');
  else root.classList.remove('theme-light');
}

export function ThemeToggle() {
  const { lang } = useT();
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    apply(theme);
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {}
  }, [theme]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  const label = theme === 'dark' ? '🌙' : '☀️';
  const title =
    lang === 'zh'
      ? theme === 'dark'
        ? '切换到浅色'
        : '切换到暗色'
      : theme === 'dark'
        ? 'Switch to light'
        : 'Switch to dark';

  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      className="px-2 py-1 rounded border border-slate-700 text-[11px] font-medium text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 transition-colors"
    >
      {label}
    </button>
  );
}
