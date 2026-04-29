import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Apply persisted theme before first paint to avoid a dark→light flash.
try {
  const stored = window.localStorage.getItem('agent-lens.theme');
  if (stored === 'light') document.documentElement.classList.add('theme-light');
} catch {}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
