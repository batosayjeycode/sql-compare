import { useCompareStore, type SideView } from '../store/compare';
import styles from './ViewSwitch.module.css';

const VIEWS: Array<{ id: SideView; label: string }> = [
  { id: 'original', label: 'Original' },
  { id: 'formatted', label: 'Formatted' },
];

/**
 * Switch both sides between Original and Formatted (FR-3.1). Each pane's
 * Format button switches one side; when the sides differ, nothing is selected.
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
        <label key={v.id} className={styles.option}>
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
