import { useRef, type KeyboardEvent } from 'react';
import { useCompareStore, type MobileTab } from '../store/compare';
import styles from './MobileTabs.module.css';

const TABS: Array<{ id: MobileTab; label: string }> = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'diff', label: 'Diff' },
  { id: 'summary', label: 'Summary' },
];

export const WORKSPACE_ID = 'workspace';
/** Tab panels: the editors (Left / Right / Diff) and the differences list (Summary). */
export const EDITORS_PANEL_ID = 'pane-editors';
export const SUMMARY_PANEL_ID = 'pane-summary';

/** Small screens: one pane at a time (PLAN §4.3), as an ARIA tab list. */
export function MobileTabs() {
  const tab = useCompareStore((s) => s.mobileTab);
  const setTab = useCompareStore((s) => s.setMobileTab);
  const semantic = useCompareStore((s) =>
    s.result ? s.result.stats.semantic + s.result.stats.unknown : 0,
  );
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const target =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? TABS.length - 1
          : step
            ? (index + step + TABS.length) % TABS.length
            : -1;
    if (target === -1) return;
    e.preventDefault();
    setTab(TABS[target]!.id);
    refs.current[target]?.focus();
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label="Panes" onKeyDown={onKeyDown}>
      {TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={t.id === 'summary' ? SUMMARY_PANEL_ID : EDITORS_PANEL_ID}
          tabIndex={tab === t.id ? 0 : -1}
          className={styles.tab}
          onClick={() => setTab(t.id)}
        >
          {t.label}
          {t.id === 'summary' && semantic > 0 && <span className={styles.badge}>{semantic}</span>}
        </button>
      ))}
    </div>
  );
}
