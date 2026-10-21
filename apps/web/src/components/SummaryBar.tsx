import type { Verdict } from '@sql-compare/core';
import { useCompareStore, type DiffSummary } from '../store/compare';
import styles from '../App.module.css';

const VERDICTS: Record<Verdict, { label: string; cls: string | undefined }> = {
  identical: { label: 'Identical', cls: styles.verdictSame },
  'formatting-only': { label: 'Formatting only', cls: styles.formatting },
  'structural-only': { label: 'Equivalent (structural)', cls: styles.structural },
  'potentially-semantic': { label: 'Potentially semantic', cls: styles.semantic },
  unknown: { label: 'Unknown', cls: styles.semantic },
};

function describeLines(diff: DiffSummary): string {
  if (diff.chunks === 0) return 'Identical text';
  const changes = `${diff.chunks} ${diff.chunks === 1 ? 'change' : 'changes'}`;
  return `${changes} · +${diff.linesAdded} −${diff.linesRemoved} lines`;
}

/** Footer: differences by category, overall verdict, and the raw line diff. */
export function SummaryBar() {
  const hasBoth = useCompareStore((s) => s.left.text !== '' && s.right.text !== '');
  const result = useCompareStore((s) => s.result);
  const stale = useCompareStore(
    (s) =>
      s.result !== null &&
      (s.result.views.left.original !== s.left.text ||
        s.result.views.right.original !== s.right.text),
  );
  const lines = useCompareStore((s) => s.diff);
  const stats = hasBoth ? result?.stats : undefined;

  const items = [
    {
      cls: styles.semantic,
      icon: '⚠',
      label: 'Semantic',
      count: stats && stats.semantic + stats.unknown,
    },
    { cls: styles.structural, icon: '≡', label: 'Structural', count: stats?.structural },
    { cls: styles.formatting, icon: '¶', label: 'Formatting', count: stats?.formatting },
  ];
  const verdict = hasBoth && result ? VERDICTS[result.verdict] : null;

  return (
    <>
      <ul className={styles.legend} aria-label="Differences by category">
        {items.map((i) => (
          <li key={i.label} className={`${styles.legendItem} ${i.cls}`}>
            <span aria-hidden="true">{i.icon}</span> {i.label}
            {i.count !== undefined && <strong className={styles.count}>{i.count}</strong>}
          </li>
        ))}
      </ul>
      <div className={styles.statusGroup}>
        {verdict && (
          <span className={`${styles.verdict} ${verdict.cls}`} data-testid="verdict">
            {stale ? 'Comparing…' : verdict.label}
          </span>
        )}
        <span className={styles.status} role="status" data-testid="diff-status">
          {!hasBoth || !lines ? 'Paste SQL on both sides to compare' : describeLines(lines)}
        </span>
      </div>
    </>
  );
}
