import { useEffect, useRef } from 'react';

interface Props {
  onResize: (w: number) => void;
  min?: number;
  max?: number;
}

export function SidebarResizer({ onResize, min = 280, max = 720 }: Props) {
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.max(min, Math.min(max, e.clientX));
      onResize(w);
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onResize, min, max]);

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      className="w-1 cursor-col-resize bg-transparent hover:bg-emerald-500/40 transition-colors flex-shrink-0"
      title="Drag to resize"
    />
  );
}
