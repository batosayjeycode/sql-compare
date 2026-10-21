import { RULES, type NormalizationRule } from '@sql-compare/core';
import { useCompareStore } from '../store/compare';
import { Popover } from './Popover';
import popover from './Popover.module.css';
import styles from './NormalizationPanel.module.css';

const LEVELS: Array<{ level: 1 | 2 | 3; name: string }> = [
  { level: 1, name: 'Formatting' },
  { level: 2, name: 'Lexical · default' },
  { level: 3, name: 'Aggressive · opt-in' },
];

/** Normalization level, Aggressive toggle and per-rule switches (FR-3, PLAN §5.4). */
export function NormalizationPanel({
  triggerClassName,
}: {
  triggerClassName?: string | undefined;
}) {
  const dialect = useCompareStore((s) => s.dialect);
  const settings = useCompareStore((s) => s.normalization);
  const setNormalization = useCompareStore((s) => s.setNormalization);
  const toggleRule = useCompareStore((s) => s.toggleRule);
  const rules = RULES.filter((r) => r.dialects.includes(dialect));

  const isOn = (r: NormalizationRule) =>
    !(r.toggleable && settings.disabledRules.includes(r.id)) &&
    (r.level < 3 || settings.aggressive);

  return (
    <Popover
      label="Normalization settings"
      trigger={`Normalize: ${settings.aggressive ? 'L3 · Aggressive' : 'L2'}`}
      triggerClassName={triggerClassName}
      wide
    >
      <p className={popover.hint}>
        Differences that normalization removes are <strong>structural</strong>: the queries are
        equivalent under the rules below. Every rewrite is re-parsed and kept only if the parse tree
        is unchanged (apart from what the rule is meant to change).
      </p>

      <label className={styles.option}>
        <input
          type="checkbox"
          checked={settings.aggressive}
          onChange={(e) => setNormalization({ aggressive: e.target.checked })}
        />
        <span>
          <strong>Aggressive normalization (L3)</strong>
          <small>
            Also treats safe reorderings as structural. SELECT column order, ORDER BY, UNION
            branches and outer joins are never reordered.
          </small>
        </span>
      </label>

      {dialect === 'mysql' && (
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={settings.caseInsensitiveTables}
            onChange={(e) => setNormalization({ caseInsensitiveTables: e.target.checked })}
          />
          <span>
            <strong>Table names are case-insensitive</strong>
            <small>
              Turn on if the server runs with lower_case_table_names = 1 or 2 (default on Windows
              and macOS).
            </small>
          </span>
        </label>
      )}

      {dialect === 'generic' && (
        <p className={popover.hint}>Generic mode has no parser, so only L1 rules apply.</p>
      )}

      {LEVELS.map(({ level, name }) => {
        const atLevel = rules.filter((r) => r.level === level);
        if (atLevel.length === 0) return null;
        return (
          <fieldset key={level} className={styles.group}>
            <legend className={popover.heading}>
              L{level} · {name}
            </legend>
            {atLevel.map((r) => (
              <label key={r.id} className={styles.rule} title={r.description}>
                <input
                  type="checkbox"
                  checked={isOn(r)}
                  disabled={!r.toggleable || (level === 3 && !settings.aggressive)}
                  onChange={() => toggleRule(r.id)}
                />
                <span>
                  <span>
                    {r.title}
                    {r.safety === 'dialect-dependent' && (
                      <span className={styles.tag} title="Behavior depends on the dialect">
                        dialect
                      </span>
                    )}
                  </span>
                  <small>{r.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </Popover>
  );
}
