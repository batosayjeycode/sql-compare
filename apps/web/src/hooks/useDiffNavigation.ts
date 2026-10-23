import { useEffect } from 'react';
import { goToDifference } from '../lib/differences';

/** Typing targets where plain letters must reach the field, not the shortcut. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

/**
 * Keyboard navigation between differences (FR-5.2): F7 / Shift+F7 anywhere,
 * n / p when focus is not in a text field or editor.
 */
export function useDiffNavigation() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'F7') {
        e.preventDefault();
        goToDifference(e.shiftKey ? -1 : 1);
        return;
      }
      if (isTyping(e.target) || e.shiftKey) return;
      if (e.key === 'n' || e.key === 'p') {
        e.preventDefault();
        goToDifference(e.key === 'n' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
