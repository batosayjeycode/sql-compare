import { RULES } from '@sql-compare/core';
import { useCompareStore } from '../store/compare';
import { Popover } from './Popover';
import popover from './Popover.module.css';
import styles from './TransformationsPanel.module.css';

const ORDER = new Map(RULES.map((r, i) => [r.id, i]));
const RULE = new Map(RULES.map((r) => [r.id, r]));

/** "Transformations applied" (FR-3.2): each rule with a count and an example. */
export function TransformationsPanel({
  triggerClassName,
}: {
  triggerClassName?: string | undefined;
}) {
  const result = useCompareStore((s) => s.result);
  const transformations = result?.transformations ?? [];
  const issues = result?.normalizationIssues ?? [];

  const byRule = new Map<
    string,
    { left: number; right: number; example: { before: string; after: string } }
  >();
  for (const t of transformations) {
    const entry = byRule.get(t.rule) ?? { left: 0, right: 0, example: t };
    entry[t.side] += t.count;
    byRule.set(t.rule, entry);
  }
  const rows = [...byRule].sort(([a], [b]) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
  const total = rows.length;

  return (
    <Popover
      label={`Transformations applied (${total})`}
      trigger={
        <>
          Transformations <strong>{total}</strong>
          {issues.length > 0 && <span className={styles.warn}> · {issues.length} skipped</span>}
        </>
      }
      triggerClassName={triggerClassName}
      placement="above"
      wide
    >
      <p className={popover.heading}>Transformations applied</p>
      {rows.length === 0 ? (
        <p className={popover.hint}>No normalization was needed.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map(([id, { left, right, example }]) => {
            const rule = RULE.get(id);
            return (
              <li key={id} className={styles.item}>
                <div className={styles.head}>
                  <span className={styles.level}>L{rule?.level}</span>
                  <span className={styles.title}>{rule?.title ?? id}</span>
                  <span
                    className={styles.count}
                    title="Edits on the original (left) and modified (right) side"
                  >
                    {left} · {right}
                  </span>
                </div>
                <code className={styles.example}>
                  <span>{example.before || '∅'}</span>
                  <span aria-label="becomes"> → </span>
                  <span>{example.after || '∅'}</span>
                </code>
              </li>
            );
          })}
        </ul>
      )}
      {issues.length > 0 && (
        <>
          <p className={popover.heading}>Not applied</p>
          <ul className={styles.list}>
            {issues.map((issue, i) => (
              <li key={i} className={`${styles.item} ${styles.issue}`}>
                {issue.side === 'left' ? 'Original' : 'Modified'}: {issue.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </Popover>
  );
}
