import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useCompareStore } from '../store/compare';
import styles from './Splitter.module.css';

const MIN = 120;
const STEP = 24;

/**
 * Resizes the differences panel (drag, or arrow keys when focused). The panel
 * size is measured from the bottom or right edge of `container`.
 */
export function Splitter({ container }: { container: React.RefObject<HTMLElement> }) {
  const dock = useCompareStore((s) => s.panel.dock);
  const size = useCompareStore((s) => (s.panel.dock === 'right' ? s.panel.width : s.panel.height));
  const setPanel = useCompareStore((s) => s.setPanel);
  const dragging = useRef(false);
  const vertical = dock === 'right';
  const resize = (n: number) => setPanel(vertical ? { width: clamp(n) } : { height: clamp(n) });

  const max = () => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return 800;
    return Math.max(MIN, (vertical ? rect.width : rect.height) - 240);
  };
  const clamp = (n: number) => Math.round(Math.min(max(), Math.max(MIN, n)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    resize(vertical ? rect.right - e.clientX : rect.bottom - e.clientY);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = vertical ? 'ArrowLeft' : 'ArrowUp';
    const shrink = vertical ? 'ArrowRight' : 'ArrowDown';
    if (e.key === grow) resize(size + STEP);
    else if (e.key === shrink) resize(size - STEP);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={styles.splitter}
      data-orientation={vertical ? 'vertical' : 'horizontal'}
      role="separator"
      aria-label="Resize differences panel"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      aria-valuemin={MIN}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
