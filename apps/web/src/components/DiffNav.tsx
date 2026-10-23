import { useMemo } from 'react';
import { CLASS_ICONS } from '@sql-compare/core';
import { goToDifference, visibleDifferences } from '../lib/differences';
import { useCompareStore, type FilterClass, type Layout } from '../store/compare';
import styles from './DiffNav.module.css';

const FILTERS: Array<{ id: FilterClass; label: string; title: string }> = [
  {
    id: 'semantic',
    label: 'Semantic',
    title: 'Potential changes in meaning (includes changes in statements that could not be parsed)',
  },
  {
    id: 'structural',
    label: 'Structural',
    title: 'Different arrangement, proven equivalent by the active normalization rules',
  },
  { id: 'formatting', label: 'Formatting', title: 'Whitespace, comments and keyword case' },
];

const LAYOUTS: Array<{ id: Layout; label: string }> = [
  { id: 'split', label: 'Side-by-side' },
  { id: 'unified', label: 'Inline' },
];

/**
 * Diff controls (FR-5.2, FR-5.3): side-by-side / inline, category filters,
 * previous / next difference, collapsing unchanged text.
 */
export function DiffNav({
  part = 'all',
  narrow = false,
}: {
  /** Small screens split the controls: mode at the top, filters and stepping at the bottom. */
  part?: 'all' | 'controls' | 'navigation';
  /** Small screens: the mode switch sets the Diff tab's layout. */
  narrow?: boolean;
}) {
  const result = useCompareStore((s) => s.result);
  const filters = useCompareStore((s) => s.filters);
  const toggleFilter = useCompareStore((s) => s.toggleFilter);
  const layout = useCompareStore((s) => (narrow ? s.mobileLayout : s.layout));
  const setLayout = useCompareStore((s) => (narrow ? s.setMobileLayout : s.setLayout));
  const showControls = part !== 'navigation';
  const showNavigation = part !== 'controls';
  const collapse = useCompareStore((s) => s.collapseUnchanged);
  const setCollapse = useCompareStore((s) => s.setCollapseUnchanged);
  const activeDiff = useCompareStore((s) => s.activeDiff);
  const hasBoth = useCompareStore((s) => s.left.text !== '' && s.right.text !== '');

  const visible = useMemo(() => visibleDifferences(result, filters), [result, filters]);
  const stats = hasBoth ? result?.stats : undefined;
  const counts: Record<FilterClass, number | undefined> = {
    semantic: stats && stats.semantic + stats.unknown,
    structural: stats?.structural,
    formatting: stats?.formatting,
  };
  const position = visible.findIndex((d) => d.id === activeDiff);
  const canStep = hasBoth && visible.length > 0;

  return (
    <div className={styles.nav}>
      {showControls && (
        <fieldset className={styles.segmented}>
          <legend className={styles.legend}>Mode</legend>
          {LAYOUTS.map((l) => (
            <label key={l.id} className={styles.option}>
              <input
                type="radio"
                name="layout"
                value={l.id}
                checked={layout === l.id}
                onChange={() => setLayout(l.id)}
              />
              <span>{l.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {showNavigation && (
        <div className={styles.group} role="group" aria-label="Show differences">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`${styles.filter} ${styles[f.id]}`}
              aria-pressed={filters[f.id]}
              title={f.title}
              onClick={() => toggleFilter(f.id)}
            >
              <span className={styles.filterIcon} aria-hidden="true">
                {filters[f.id] ? '✓' : CLASS_ICONS[f.id]}
              </span>{' '}
              {f.label}
              {counts[f.id] !== undefined && (
                <>
                  {' '}
                  <strong className={styles.count}>{counts[f.id]}</strong>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {showNavigation && (
        <div className={styles.group} role="group" aria-label="Navigate differences">
          <button
            type="button"
            className={styles.step}
            disabled={!canStep}
            onClick={() => goToDifference(-1)}
            title="Previous difference (p, Shift+F7)"
            aria-keyshortcuts="p Shift+F7"
          >
            ◀ Prev
          </button>
          <span className={styles.position} aria-live="polite" data-testid="diff-position">
            {canStep ? `${position === -1 ? '–' : position + 1} / ${visible.length}` : '0 / 0'}
          </span>
          <button
            type="button"
            className={styles.step}
            disabled={!canStep}
            onClick={() => goToDifference(1)}
            title="Next difference (n, F7)"
            aria-keyshortcuts="n F7"
          >
            Next ▶
          </button>
        </div>
      )}

      {showControls && (
        <label className={styles.check} title="Fold long runs of unchanged lines">
          <input
            type="checkbox"
            checked={collapse}
            onChange={(e) => setCollapse(e.target.checked)}
          />
          Collapse unchanged
        </label>
      )}
    </div>
  );
}
