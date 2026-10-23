import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { formatSql } from '../src/format.js';
import { loadParser, type ParserAdapter } from '../src/parse.js';
import {
  buildReport,
  groupDifferences,
  inlineCodeToHtml,
  pairLabel,
  renderReport,
} from '../src/report.js';
import { createViewMapper } from '../src/views.js';
import { selectSql } from './arbitraries.js';

let pg: ParserAdapter;
beforeAll(async () => {
  pg = (await loadParser('postgresql'))!;
});

const options = { dialect: 'postgresql', level: 2 } as const;
const LEFT = 'SELECT a, b FROM t JOIN u ON t.id = u.id WHERE x = 1;\nUPDATE t SET a = 1;';
const RIGHT =
  'select a, b, c from t left join u on t.id = u.id where x = 2;\nUPDATE t SET a = 1;\nDROP TABLE old;';

describe('report', () => {
  it('groups differences by statement, then clause', () => {
    const result = compare(LEFT, RIGHT, options, pg);
    const groups = groupDifferences(result);
    expect(groups.map((g) => g.label)).toEqual([
      'Statement 1 · SELECT',
      'Statement 3 · DROP TABLE (added)',
    ]);
    // Formatting changes are filed under their clause too.
    expect(groups[0]!.clauses.map((c) => c.clause)).toEqual(['SELECT', 'FROM', 'WHERE']);
    expect(groups[0]!.clauses[0]!.differences.map((d) => d.class)).toContain('formatting');
    const semanticOnly = groupDifferences(result, new Set(['semantic']));
    expect(semanticOnly[0]!.clauses.map((c) => c.clause)).toEqual(['SELECT', 'FROM', 'WHERE']);
  });

  it('labels statement pairs', () => {
    const base = { index: 0, kind: 'SELECT' } as const;
    expect(pairLabel({ ...base, left: 0, right: 0, status: 'changed' })).toBe(
      'Statement 1 · SELECT',
    );
    expect(pairLabel({ ...base, left: 2, right: 0, status: 'moved' })).toBe(
      'Statement 3 → 1 · SELECT (moved)',
    );
    expect(pairLabel({ ...base, left: 1, right: null, status: 'removed' })).toBe(
      'Statement 2 · SELECT (removed)',
    );
    expect(pairLabel({ index: 0, kind: '', left: null, right: null, status: 'changed' })).toBe(
      'Input',
    );
  });

  it('builds JSON with locations and rule titles', () => {
    const result = compare(
      'SELECT a FROM t INNER JOIN u ON t.id = u.id',
      'SELECT a FROM t JOIN u ON t.id = u.id WHERE z',
      options,
      pg,
    );
    const report = JSON.parse(
      renderReport({ result, options, generatedAt: new Date(0) }, 'json'),
    ) as ReturnType<typeof buildReport>;
    expect(report.verdict).toBe('potentially-semantic');
    expect(report.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    const diffs = report.statements[0]!.clauses.flatMap((c) => c.differences);
    const structural = diffs.find((d) => d.class === 'structural')!;
    expect(structural.resolvedBy).toEqual([
      { id: 'join-synonyms', title: 'Canonical join keywords' },
    ]);
    expect(structural.left).toMatchObject({ line: 1, column: 17, text: 'INNER' });
    const added = diffs.find((d) => d.class === 'semantic')!;
    expect(added.description).toBe('Added clause `WHERE z`');
    expect(added.right).toMatchObject({ text: 'WHERE z' });
  });

  it('renders Markdown tables with escaped cells', () => {
    const result = compare('SELECT a || b AS x FROM t', 'SELECT a || c AS x FROM t', options, pg);
    const md = renderReport(
      { result, options, names: { left: 'old.sql', right: null } },
      'markdown',
    );
    expect(md).toContain('# SQL comparison report');
    expect(md).toContain('- **Verdict:** Potentially semantic');
    expect(md).toContain('- **Inputs:** old.sql → (pasted)');
    expect(md).toContain('## Statement 1 · SELECT');
    expect(md).toContain(
      '| ⚠ Semantic | major | SELECT | Column `x` changed: `a \\|\\| b` → `a \\|\\| c` | 1:13 | 1:13 |',
    );
  });

  it('renders standalone, escaped HTML', () => {
    const result = compare("SELECT '<b>' AS x FROM t", "SELECT '<i>' AS x FROM t", options, pg);
    const html = renderReport({ result, options }, 'html');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<b>');
    expect(html).toContain('<code>&#39;&lt;b&gt;&#39;</code>'.replace(/&#39;/g, "'"));
    expect(html).not.toMatch(/<script|src=|href=/);
  });

  it('converts code spans, including fenced backticks', () => {
    expect(inlineCodeToHtml('Changed `a<b` → `` `x` ``')).toBe(
      'Changed <code>a&lt;b</code> → <code>`x`</code>',
    );
    expect(inlineCodeToHtml('no code & `open')).toBe('no code &amp; `open');
  });

  it('says so when there are no differences', () => {
    const result = compare('SELECT 1', 'SELECT 1', options, pg);
    expect(renderReport({ result, options }, 'markdown')).toContain('No differences.');
  });
});

describe('view mapping', () => {
  it('maps the original view to itself', () => {
    const m = createViewMapper('SELECT 1', 'SELECT 1', 'postgresql', { kind: 'original' })!;
    expect(m.toDisplay({ start: 7, end: 8 })).toEqual({ from: 7, to: 8 });
    expect(createViewMapper('SELECT 1', 'SELECT 2', 'postgresql', { kind: 'original' })).toBeNull();
  });

  it('maps ranges into the formatted view token by token', () => {
    const original = 'select a,b from t where x=1';
    const formatted = formatSql(original, 'postgresql');
    if (!formatted.ok) throw new Error(formatted.message);
    const m = createViewMapper(original, formatted.text, 'postgresql', { kind: 'formatted' })!;
    const x = original.indexOf('x=1');
    const r = m.toDisplay({ start: x, end: x + 3 });
    expect(formatted.text.slice(r.from, r.to)).toBe('x = 1');
    expect(m.toSource(r.from)).toBe(x);
    // Insertion point right after `b`.
    const b = original.indexOf('b ') + 1;
    const at = m.toDisplay({ start: b, end: b });
    expect(formatted.text.slice(at.from - 1, at.from)).toBe('b');
    // Before the first token: before it.
    expect(m.toDisplay({ start: 0, end: 0 })).toEqual({ from: 0, to: 0 });
  });

  it('maps ranges into the normalized view, also when tokens were reordered', () => {
    const left = 'SELECT a FROM t WHERE y = 2 AND x = 1';
    const result = compare(left, left, { dialect: 'postgresql', level: 3 }, pg);
    const view = result.views.left;
    const m = createViewMapper(left, view.normalized!, 'postgresql', {
      kind: 'normalized',
      sources: view.normalizedSources!,
    })!;
    const y = left.indexOf('y = 2');
    const r = m.toDisplay({ start: y, end: y + 5 });
    expect(view.normalized!.slice(r.from, r.to)).toBe('y = 2');
    expect(view.normalized!.indexOf('x = 1')).toBeLessThan(r.from);
  });

  it('formatted mapping covers every token (property)', () => {
    fc.assert(
      fc.property(selectSql, (sql) => {
        const formatted = formatSql(sql, 'postgresql');
        if (!formatted.ok) return;
        const m = createViewMapper(sql, formatted.text, 'postgresql', { kind: 'formatted' });
        expect(m).not.toBeNull();
        const r = m!.toDisplay({ start: 0, end: sql.length });
        expect(r.from).toBeGreaterThanOrEqual(0);
        expect(r.to).toBeLessThanOrEqual(formatted.text.length);
      }),
      { numRuns: 100 },
    );
  });
});
