import { useEffect, useRef, useState } from 'react';
import { subscribeProgress } from '../progress';

export function ProgressBar() {
  const [active, setActive] = useState(false);
  const [pct, setPct] = useState(0);
  const timerRef = useRef<number | null>(null);
  const fadeRef = useRef<number | null>(null);

  useEffect(() => {
    return subscribeProgress((count) => {
      if (count > 0) {
        if (fadeRef.current) {
          window.clearTimeout(fadeRef.current);
          fadeRef.current = null;
        }
        if (!timerRef.current) {
          setActive(true);
          setPct(8);
          timerRef.current = window.setInterval(() => {
            setPct((p) => (p < 90 ? p + (90 - p) * 0.08 : p));
          }, 120);
        }
      } else {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setPct(100);
        fadeRef.current = window.setTimeout(() => {
          setActive(false);
          setPct(0);
        }, 280);
      }
    });
  }, []);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 h-0.5 pointer-events-none"
      style={{ opacity: active ? 1 : 0, transition: 'opacity 200ms ease' }}
    >
      <div
        className="h-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-emerald-500"
        style={{
          width: `${pct}%`,
          transition: 'width 180ms ease-out',
          boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)',
        }}
      />
    </div>
  );
}
