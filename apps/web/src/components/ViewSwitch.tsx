import { useCompareStore, type SideView } from '../store/compare';
import styles from './ViewSwitch.module.css';

const VIEWS: Array<{ id: SideView; label: string; title: string }> = [
  { id: 'original', label: 'Original', title: 'The SQL as written (editable)' },
  {
    id: 'formatted',
    label: 'Formatted',
    title: 'Pretty-printed: whitespace and keyword case only',
  },
  {
    id: 'normalized',
    label: 'Normalized',
    title: 'After the active normalization rules: only potentially semantic differences remain',
  },
];

/**
 * Switch both sides between Original, Formatted and Normalized (FR-3.1). Each
 * pane's Format button switches one side; when the sides differ, nothing is
 * selected.
 */
export function ViewSwitch() {
  const views = useCompareStore((s) => s.views);
  const setAllViews = useCompareStore((s) => s.setAllViews);
  const hasText = useCompareStore((s) => s.left.text.trim() !== '' || s.right.text.trim() !== '');
  const current = views.left === views.right ? views.left : null;

  return (
    <fieldset className={styles.switch} disabled={!hasText}>
      <legend className={styles.legend}>View</legend>
      {VIEWS.map((v) => (
        <label key={v.id} className={styles.option} title={v.title}>
          <input
            type="radio"
            name="view"
            value={v.id}
            checked={current === v.id}
            onChange={() => setAllViews(v.id)}
          />
          <span>{v.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
