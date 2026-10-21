import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './Popover.module.css';

interface PopoverProps {
  /** Accessible name of the panel (and tooltip of the trigger). */
  label: string;
  /** Visible trigger content (icon or text). */
  trigger: ReactNode;
  /** The trigger is an icon: name it with `label` (text triggers are named by their text). */
  iconOnly?: boolean;
  triggerClassName?: string | undefined;
  /** Panel below the trigger, right-aligned (toolbar) or above it, left-aligned (footer). */
  placement?: 'below' | 'above';
  wide?: boolean;
  children: ReactNode;
}

/** Button + non-modal panel. Closes on outside click and Escape (focus returns to the button). */
export function Popover({
  label,
  trigger,
  iconOnly = false,
  triggerClassName,
  placement = 'below',
  wide = false,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName ?? styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={iconOnly ? label : undefined}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          className={`${styles.panel} ${styles[placement]} ${wide ? styles.wide : ''}`}
          role="group"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}
