import type { FormatOptions, KeywordCase } from '@sql-compare/core';
import { useCompareStore } from '../store/compare';
import { Popover } from './Popover';
import styles from './Popover.module.css';

const LINE_WIDTHS = [30, 50, 80, 100, 120];

type Indent = '2' | '4' | 'tab';

function indentValue(o: FormatOptions): Indent {
  return o.useTabs ? 'tab' : o.indentWidth === 4 ? '4' : '2';
}

/** ⚙ button with a popover of formatter options (FR-2). */
export function FormatOptionsPanel() {
  const options = useCompareStore((s) => s.formatOptions);
  const setOptions = useCompareStore((s) => s.setFormatOptions);
  const reset = useCompareStore((s) => s.resetFormatOptions);

  const onIndent = (value: Indent) =>
    setOptions(
      value === 'tab' ? { useTabs: true } : { useTabs: false, indentWidth: Number(value) },
    );

  return (
    <Popover label="Formatting options" trigger="⚙" iconOnly>
      <label className={styles.row}>
        <span>Keyword case</span>
        <select
          value={options.keywordCase}
          onChange={(e) => setOptions({ keywordCase: e.target.value as KeywordCase })}
        >
          <option value="upper">UPPER</option>
          <option value="lower">lower</option>
          <option value="preserve">Preserve</option>
        </select>
      </label>
      <label className={styles.row}>
        <span>Indent</span>
        <select value={indentValue(options)} onChange={(e) => onIndent(e.target.value as Indent)}>
          <option value="2">2 spaces</option>
          <option value="4">4 spaces</option>
          <option value="tab">Tab</option>
        </select>
      </label>
      <label className={styles.row}>
        <span>Line width</span>
        <select
          value={options.lineWidth}
          onChange={(e) => setOptions({ lineWidth: Number(e.target.value) })}
        >
          {LINE_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.row}>
        <span>AND / OR</span>
        <select
          value={options.logicalOperatorNewline}
          onChange={(e) =>
            setOptions({
              logicalOperatorNewline: e.target.value as FormatOptions['logicalOperatorNewline'],
            })
          }
        >
          <option value="before">Start of line</option>
          <option value="after">End of line</option>
        </select>
      </label>
      <p className={styles.hint}>
        Formatting only changes whitespace and keyword case. Output is checked token by token and
        discarded if anything else would change.
      </p>
      <button type="button" className={styles.button} onClick={reset}>
        Reset to defaults
      </button>
    </Popover>
  );
}
