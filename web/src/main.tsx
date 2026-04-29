import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// One-shot localStorage migration: agent-lens.* → pawscope.*
try {
  const ls = window.localStorage;
  for (const oldKey of ['agent-lens.theme', 'agent-lens.lang', 'agent-lens.skills.collapsed']) {
    const val = ls.getItem(oldKey);
    if (val == null) continue;
    const newKey = oldKey.replace(/^agent-lens\./, 'pawscope.');
    if (ls.getItem(newKey) == null) ls.setItem(newKey, val);
    ls.removeItem(oldKey);
  }
} catch {}

// Apply persisted theme before first paint to avoid a dark→light flash.
try {
  const stored = window.localStorage.getItem('pawscope.theme');
  if (stored === 'light') document.documentElement.classList.add('theme-light');
} catch {}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
