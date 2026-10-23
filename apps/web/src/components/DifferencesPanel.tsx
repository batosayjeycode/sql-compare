import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CLASS_ICONS,
  CLASS_LABELS,
  groupDifferences,
  RULES,
  splitCodeSpans,
  type DiffClass,
  type Difference,
  type ReportFormat,
} from '@sql-compare/core';
import { NARROW } from '../hooks/useMediaQuery';
import { downloadReport } from '../lib/download';
import { filterOf } from '../lib/differences';
import { compareOptionsOf, useCompareStore } from '../store/compare';
import { Popover } from './Popover';
import popover from './Popover.module.css';
import styles from './DifferencesPanel.module.css';

const PAGE = 200;
const RULE_TITLES = new Map(RULES.map((r) => [r.id, r.title]));

/** A description with its `code` spans rendered as <code>. */
export function Description({ text }: { text: string }) {
  return (
    <>
      {splitCodeSpans(text).map((p, i): ReactNode =>
        p.code ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}

function DifferenceItem({ d, clause }: { d: Difference; clause: string }) {
  const active = useCompareStore((s) => s.activeDiff === d.id);
  const setActiveDiff = useCompareStore((s) => s.setActiveDiff);
  const setHoverDiff = useCompareStore((s) => s.setHoverDiff);
  const ref = useRef<HTMLButtonElement>(null);

  // Keyboard navigation (n/p, F7) keeps the selected entry in view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const notes = [
    d.resolvedBy &&
      `Resolved by ${d.resolvedBy
        .split(',')
        .map((id) => RULE_TITLES.get(id) ?? id)
        .join(', ')}`,
    d.l3Hint,
  ].filter((n): n is string => Boolean(n));
  const cls = filterOf(d.class);

  return (
    <li>
      <button
        ref={ref}
        type="button"
        className={`${styles.item} ${styles[cls]}`}
        aria-current={active ? 'true' : undefined}
        title={clause}
        data-diff={d.id}
        onClick={() => {
          // Small screens: the list is its own tab; show the diff, then scroll to the entry.
          const { mobileTab, setMobileTab } = useCompareStore.getState();
          if (mobileTab === 'summary' && window.matchMedia?.(NARROW).matches) {
            setMobileTab('diff');
            requestAnimationFrame(() => setActiveDiff(d.id, true));
          } else {
            setActiveDiff(d.id, true);
          }
        }}
        onMouseEnter={() => setHoverDiff(d.id)}
        onMouseLeave={() => setHoverDiff(null)}
        onFocus={() => setHoverDiff(d.id)}
        onBlur={() => setHoverDiff(null)}
      >
        <span className={styles.icon} aria-hidden="true">
          {CLASS_ICONS[d.class]}
        </span>
        <span className={styles.text}>
          {/* The class is shown by icon and color; screen readers hear it first. */}
          <span className={styles.srOnly}>{CLASS_LABELS[d.class]}: </span>
          <span className={styles.description}>
            <Description text={d.description} />
          </span>
          {notes.map((n) => (
            <span key={n} className={styles.note}>
              {n}
            </span>
          ))}
        </span>
        <span className={`${styles.severity} ${styles[d.severity]}`}>{d.severity}</span>
      </button>
    </li>
  );
}

function ExportMenu() {
  const [filtered, setFiltered] = useState(false);
  const run = (format: ReportFormat) => {
    const s = useCompareStore.getState();
    if (!s.result) return;
    const classes = new Set<DiffClass>(
      (['semantic', 'unknown', 'structural', 'formatting'] as const).filter(
        (c) => s.filters[filterOf(c)],
      ),
    );
    downloadReport(
      {
        result: s.result,
        options: compareOptionsOf(s),
        names: { left: s.left.fileName, right: s.right.fileName },
        ...(filtered ? { classes } : {}),
      },
      format,
    );
  };
  return (
    <Popover label="Export report" trigger="Export" triggerClassName={styles.headerButton}>
      <p className={popover.heading}>Export report</p>
      <p className={popover.hint}>Saved on this device; nothing is uploaded.</p>
      <div className={styles.exportButtons}>
        <button type="button" className={styles.exportButton} onClick={() => run('markdown')}>
          Markdown
        </button>
        <button type="button" className={styles.exportButton} onClick={() => run('html')}>
          HTML
        </button>
        <button type="button" className={styles.exportButton} onClick={() => run('json')}>
          JSON
        </button>
      </div>
      <label className={styles.exportOption}>
        <input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} />
        Only the categories shown by the filters
      </label>
    </Popover>
  );
}

/**
 * Structured list of differences grouped by statement → clause (FR-6.1).
 * Clicking an entry selects it and scrolls both panes to it (FR-5.1);
 * hovering highlights it on both sides.
 */
export function DifferencesPanel() {
  const result = useCompareStore((s) => s.result);
  const filters = useCompareStore((s) => s.filters);
  const hasBoth = useCompareStore((s) => s.left.text !== '' && s.right.text !== '');
  const dock = useCompareStore((s) => s.panel.dock);
  const setPanel = useCompareStore((s) => s.setPanel);

  const shown = useMemo(() => {
    const classes = new Set<DiffClass>(
      (['semantic', 'unknown', 'structural', 'formatting'] as const).filter(
        (c) => filters[filterOf(c)],
      ),
    );
    return result ? groupDifferences(result, classes) : [];
  }, [result, filters]);
  const total = result?.differences.length ?? 0;
  const visible = shown.reduce(
    (n, g) => n + g.clauses.reduce((m, c) => m + c.differences.length, 0),
    0,
  );

  // Long lists render in pages, so thousands of entries never block the page.
  const [limit, setLimit] = useState(PAGE);
  const activeDiff = useCompareStore((s) => s.activeDiff);
  useEffect(() => setLimit(PAGE), [result]);
  const order = useMemo(
    () => shown.flatMap((g) => g.clauses.flatMap((c) => c.differences.map((d) => d.id))),
    [shown],
  );
  useEffect(() => {
    const index = activeDiff ? order.indexOf(activeDiff) : -1;
    if (index >= limit) setLimit(Math.ceil((index + 1) / PAGE) * PAGE);
  }, [activeDiff, order, limit]);
  const pages = useMemo(() => {
    let budget = limit;
    return shown
      .map((g) => ({
        ...g,
        clauses: g.clauses
          .map((c) => {
            const differences = c.differences.slice(0, Math.max(0, budget));
            budget -= differences.length;
            return { ...c, differences };
          })
          .filter((c) => c.differences.length > 0),
      }))
      .filter((g) => g.clauses.length > 0);
  }, [shown, limit]);

  let empty: string | null = null;
  if (!hasBoth || !result) empty = 'Paste SQL on both sides to see the differences.';
  else if (total === 0) empty = 'No differences: the inputs are identical.';
  else if (visible === 0) {
    empty = `${total} ${total === 1 ? 'difference is' : 'differences are'} hidden by the filters.`;
  }

  return (
    <section className={styles.panel} aria-labelledby="differences-heading">
      <header className={styles.header}>
        <h2 id="differences-heading" className={styles.heading}>
          Differences
          {hasBoth && result && (
            <span className={styles.total}>
              {visible === total ? total : `${visible} of ${total}`}
            </span>
          )}
        </h2>
        <div className={styles.actions}>
          {hasBoth && result && <ExportMenu />}
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => setPanel({ dock: dock === 'bottom' ? 'right' : 'bottom' })}
            title={dock === 'bottom' ? 'Dock to the right' : 'Dock to the bottom'}
            aria-label={dock === 'bottom' ? 'Dock panel to the right' : 'Dock panel to the bottom'}
          >
            {dock === 'bottom' ? '⇥' : '⤓'}
          </button>
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => setPanel({ open: false })}
            aria-label="Hide differences panel"
            title="Hide panel"
          >
            ✕
          </button>
        </div>
      </header>
      <div className={styles.body}>
        {empty ? (
          <p className={styles.empty}>{empty}</p>
        ) : (
          pages.map((g) => (
            <section key={g.pair.index} className={styles.group} aria-label={g.label}>
              <h3 className={styles.groupHeading}>{g.label}</h3>
              {g.clauses.map((c) => (
                <div key={c.clause} className={styles.clause}>
                  <h4 className={styles.clauseHeading}>{c.clause}</h4>
                  <ul className={styles.list}>
                    {c.differences.map((d) => (
                      <DifferenceItem key={d.id} d={d} clause={`${g.label}, ${c.clause}`} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
        {!empty && visible > limit && (
          <button type="button" className={styles.more} onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, visible - limit)} more of {visible - limit} remaining
          </button>
        )}
      </div>
    </section>
  );
}
