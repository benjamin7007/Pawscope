import { useEffect, useRef, useState } from 'react';
import { subscribeProgress, subscribeProgressError } from '../progress';

export function ProgressBar() {
  const [active, setActive] = useState(false);
  const [pct, setPct] = useState(0);
  const [errored, setErrored] = useState(false);
  const timerRef = useRef<number | null>(null);
  const fadeRef = useRef<number | null>(null);
  const erroredRef = useRef(false);

  useEffect(() => {
    const offErr = subscribeProgressError(() => {
      erroredRef.current = true;
      setErrored(true);
    });
    const off = subscribeProgress((count) => {
      if (count > 0) {
        if (fadeRef.current) {
          window.clearTimeout(fadeRef.current);
          fadeRef.current = null;
        }
        if (!timerRef.current) {
          erroredRef.current = false;
          setErrored(false);
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
        // Linger longer on error so user can register the red flash
        const linger = erroredRef.current ? 1200 : 280;
        fadeRef.current = window.setTimeout(() => {
          setActive(false);
          setPct(0);
          setErrored(false);
          erroredRef.current = false;
        }, linger);
      }
    });
    return () => {
      off();
      offErr();
    };
  }, []);

  const gradient = errored
    ? 'linear-gradient(90deg, #f43f5e, #fb7185, #f43f5e)'
    : 'linear-gradient(90deg, #10b981, #22d3ee, #10b981)';
  const glow = errored
    ? '0 0 8px rgba(244, 63, 94, 0.7)'
    : '0 0 8px rgba(16, 185, 129, 0.6)';

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 h-0.5 pointer-events-none"
      style={{ opacity: active ? 1 : 0, transition: 'opacity 200ms ease' }}
    >
      <div
        className="h-full"
        style={{
          width: `${pct}%`,
          transition: 'width 180ms ease-out, background 200ms ease',
          backgroundImage: gradient,
          boxShadow: glow,
        }}
      />
    </div>
  );
}
