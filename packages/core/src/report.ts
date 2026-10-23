import { lineColumn } from './location.js';
import { code } from './diff/text.js';
import { RULES } from './normalize/rules/index.js';
import type {
  CompareOptions,
  ComparisonResult,
  DiffClass,
  Difference,
  SourceRange,
  StatementPair,
  Verdict,
} from './types.js';

/**
 * Comparison report (FR-6.1, FR-6.2): differences grouped by statement and
 * clause, exported as Markdown, standalone HTML or JSON. Pure functions, no DOM.
 */

export type ReportFormat = 'markdown' | 'html' | 'json';

export const VERDICT_LABELS: Record<Verdict, string> = {
  identical: 'Identical',
  'formatting-only': 'Formatting only',
  'structural-only': 'Equivalent (structural)',
  'potentially-semantic': 'Potentially semantic',
  unknown: 'Unknown (unparsed SQL)',
};

export const CLASS_LABELS: Record<DiffClass, string> = {
  semantic: 'Semantic',
  structural: 'Structural',
  formatting: 'Formatting',
  unknown: 'Unknown',
};

/** Icons paired with every class color, so a class is never shown by color alone. */
export const CLASS_ICONS: Record<DiffClass, string> = {
  semantic: '⚠',
  structural: '≡',
  formatting: '¶',
  unknown: '?',
};

const DIALECT_LABELS: Record<CompareOptions['dialect'], string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  generic: 'Generic',
};

export interface DifferenceGroup {
  pair: StatementPair;
  /** "Statement 2 · UPDATE". */
  label: string;
  clauses: Array<{ clause: string; differences: Difference[] }>;
}

/** Display label of an aligned statement pair, e.g. "Statement 2 → 3 · UPDATE (moved)". */
export function pairLabel(pair: StatementPair): string {
  const { left: l, right: r } = pair;
  if (l === null && r === null) return 'Input';
  const position =
    l !== null && r !== null && l !== r
      ? `Statement ${l + 1} → ${r + 1}`
      : `Statement ${(r ?? l)! + 1}`;
  const kind = pair.kind ? ` · ${pair.kind}` : '';
  const status =
    pair.status === 'added' || pair.status === 'removed' || pair.status === 'moved'
      ? ` (${pair.status})`
      : '';
  return `${position}${kind}${status}`;
}

/** Clause a difference belongs to: the second path segment, or the statement itself. */
export function clauseOf(d: Difference): string {
  return d.path[1] ?? 'statement';
}

/** Group differences (optionally only some classes) by statement pair, then clause, in order. */
export function groupDifferences(
  result: ComparisonResult,
  classes?: ReadonlySet<DiffClass>,
): DifferenceGroup[] {
  const groups = new Map<number, DifferenceGroup>();
  for (const d of result.differences) {
    if (classes && !classes.has(d.class)) continue;
    const pair = result.pairs[d.statementPair];
    if (!pair) continue;
    let group = groups.get(pair.index);
    if (!group) {
      group = { pair, label: pairLabel(pair), clauses: [] };
      groups.set(pair.index, group);
    }
    const clause = clauseOf(d);
    let entry = group.clauses.find((c) => c.clause === clause);
    if (!entry) {
      entry = { clause, differences: [] };
      group.clauses.push(entry);
    }
    entry.differences.push(d);
  }
  return [...groups.values()].sort((a, b) => a.pair.index - b.pair.index);
}

export interface ReportInput {
  result: ComparisonResult;
  options: CompareOptions;
  /** Uploaded file names, if any. */
  names?: { left?: string | null; right?: string | null };
  /** Classes to include (default: all). */
  classes?: ReadonlySet<DiffClass>;
  generatedAt?: Date;
}

interface Location {
  start: number;
  end: number;
  line: number;
  column: number;
  text: string;
}

const MAX_TEXT = 200;
const RULE_TITLES = new Map(RULES.map((r) => [r.id, r.title]));

function location(source: string, range: SourceRange | undefined): Location | null {
  if (!range) return null;
  const text = source.slice(range.start, range.end);
  return {
    start: range.start,
    end: range.end,
    ...lineColumn(source, range.start),
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text,
  };
}

/** The report as plain data (also the JSON export). */
export function buildReport(input: ReportInput) {
  const { result, options } = input;
  const original = { left: result.views.left.original, right: result.views.right.original };
  const groups = groupDifferences(result, input.classes);
  return {
    tool: 'SQL Compare',
    format: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    inputs: {
      left: { name: input.names?.left ?? null, length: original.left.length },
      right: { name: input.names?.right ?? null, length: original.right.length },
    },
    options: {
      dialect: options.dialect,
      level: options.level,
      disabledRules: [...(options.disabledRules ?? [])],
      caseInsensitiveTables: options.caseInsensitiveTables ?? false,
    },
    parser: result.parser,
    verdict: result.verdict,
    verdictLabel: VERDICT_LABELS[result.verdict],
    stats: result.stats,
    included: input.classes ? [...input.classes] : null,
    statements: groups.map((g) => ({
      label: g.label,
      left: g.pair.left,
      right: g.pair.right,
      status: g.pair.status,
      kind: g.pair.kind,
      clauses: g.clauses.map((c) => ({
        clause: c.clause,
        differences: c.differences.map((d) => ({
          id: d.id,
          class: d.class,
          kind: d.kind,
          severity: d.severity,
          description: d.description,
          path: d.path,
          ...(d.resolvedBy
            ? {
                resolvedBy: d.resolvedBy
                  .split(',')
                  .map((id) => ({ id, title: RULE_TITLES.get(id) ?? id })),
              }
            : {}),
          ...(d.l3Hint ? { l3Hint: d.l3Hint } : {}),
          left: location(original.left, d.left),
          right: location(original.right, d.right),
        })),
      })),
    })),
    transformations: result.transformations,
    normalizationIssues: result.normalizationIssues,
    errors: result.errors,
  };
}

export type Report = ReturnType<typeof buildReport>;

function levelLabel(level: number): string {
  return level >= 3 ? 'L3 (aggressive)' : level === 2 ? 'L2 (default)' : `L${level}`;
}

function statsLine(report: Report): string {
  const s = report.stats;
  const total = s.semantic + s.structural + s.formatting + s.unknown;
  return `${total} ${total === 1 ? 'difference' : 'differences'}: ${s.semantic} semantic · ${s.structural} structural · ${s.formatting} formatting${s.unknown ? ` · ${s.unknown} unknown` : ''}`;
}

const where = (loc: Location | null) => (loc ? `${loc.line}:${loc.column}` : '—');

// --- Markdown ----------------------------------------------------------------

const mdCell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(input: ReportInput): string {
  const report = buildReport(input);
  const out: string[] = ['# SQL comparison report', ''];
  out.push(`- **Verdict:** ${report.verdictLabel}`);
  out.push(`- **Differences:** ${statsLine(report)}`);
  if (report.included) {
    out.push(`- **Included:** ${report.included.map((c) => CLASS_LABELS[c]).join(', ')}`);
  }
  out.push(
    `- **Dialect:** ${DIALECT_LABELS[report.options.dialect]} · **Normalization:** ${levelLabel(report.options.level)} · **Parser:** ${report.parser ?? 'none (token diff only)'}`,
  );
  const names = [report.inputs.left.name, report.inputs.right.name];
  if (names.some(Boolean)) {
    out.push(`- **Inputs:** ${names[0] ?? '(pasted)'} → ${names[1] ?? '(pasted)'}`);
  }
  out.push(`- **Generated:** ${report.generatedAt}`, '');

  if (report.statements.length === 0) out.push('No differences.', '');
  for (const s of report.statements) {
    out.push(`## ${s.label}`, '');
    out.push('| Class | Severity | Clause | Description | Left | Right |');
    out.push('|---|---|---|---|---|---|');
    for (const c of s.clauses) {
      for (const d of c.differences) {
        const notes = [
          d.resolvedBy ? `resolved by ${d.resolvedBy.map((r) => r.title).join(', ')}` : '',
          d.l3Hint ?? '',
        ].filter(Boolean);
        const description =
          notes.length > 0 ? `${d.description} (${notes.join('; ')})` : d.description;
        out.push(
          `| ${CLASS_ICONS[d.class]} ${CLASS_LABELS[d.class]} | ${d.severity} | ${mdCell(c.clause)} | ${mdCell(description)} | ${where(d.left)} | ${where(d.right)} |`,
        );
      }
    }
    out.push('');
  }

  if (report.transformations.length > 0) {
    out.push('## Transformations applied', '');
    out.push('| Rule | Side | Statement | Edits | Example |');
    out.push('|---|---|---|---|---|');
    for (const t of report.transformations) {
      const example = t.after ? `${t.before} → ${t.after}` : `${t.before} → (removed)`;
      out.push(
        `| ${mdCell(RULE_TITLES.get(t.rule) ?? t.rule)} | ${t.side} | ${t.statementIndex < 0 ? 'all' : t.statementIndex + 1} | ${t.count} | ${mdCell(code(example))} |`,
      );
    }
    out.push('');
  }
  if (report.normalizationIssues.length > 0) {
    out.push('## Rules not applied', '');
    for (const i of report.normalizationIssues) out.push(`- ${i.side}: ${i.message}`);
    out.push('');
  }
  if (report.errors.length > 0) {
    out.push('## Parse errors', '');
    for (const e of report.errors) {
      out.push(
        `- ${e.side} ${e.line}:${e.column} (statement ${e.statementIndex + 1}): ${e.message}`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

// --- HTML --------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Split text into plain and code parts at Markdown code spans (as written by descriptions). */
export function splitCodeSpans(text: string): Array<{ code: boolean; text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('`', i);
    if (open === -1) break;
    let fence = 1;
    while (text[open + fence] === '`') fence++;
    const close = text.indexOf('`'.repeat(fence), open + fence);
    if (close === -1) break;
    let inner = text.slice(open + fence, close);
    if (fence > 1 && inner.startsWith(' ') && inner.endsWith(' ')) inner = inner.slice(1, -1);
    if (open > i) parts.push({ code: false, text: text.slice(i, open) });
    parts.push({ code: true, text: inner });
    i = close + fence;
  }
  if (i < text.length) parts.push({ code: false, text: text.slice(i) });
  return parts;
}

/** Escape text and turn its code spans into <code>. */
export function inlineCodeToHtml(text: string): string {
  return splitCodeSpans(text)
    .map((p) => (p.code ? `<code>${escapeHtml(p.text)}</code>` : escapeHtml(p.text)))
    .join('');
}

const HTML_STYLE = `
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1d2230;background:#fff}
h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:#f1f3f8;padding:0 .25em;border-radius:3px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:.35rem .5rem;border-bottom:1px solid #e3e6ee}
th{font-weight:600;color:#555b6e}.meta{list-style:none;padding:0}.meta li{margin:.15rem 0}
.semantic{color:#9a6200}.unknown{color:#9a6200}.structural{color:#6d3fc0}.formatting{color:#5c6273}
.sev{font-size:.85em;border:1px solid currentColor;border-radius:999px;padding:0 .4em}.major{color:#b3243c}.minor{color:#9a6200}.info{color:#5c6273}
.note{color:#555b6e;font-size:.9em}.loc{font-variant-numeric:tabular-nums;white-space:nowrap}
@media (prefers-color-scheme:dark){body{background:#12141c;color:#e7e9f2}code{background:#22263a}th{color:#a3a8bd}th,td{border-color:#2a2f45}
.semantic,.unknown,.minor{color:#f0b43c}.structural{color:#b49af0}.formatting,.info,.note{color:#9aa0b5}.major{color:#f07088}}`;

export function renderHtml(input: ReportInput): string {
  const report = buildReport(input);
  const e = escapeHtml;
  const parts: string[] = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SQL comparison report</title>',
    `<style>${HTML_STYLE}</style></head><body>`,
    '<h1>SQL comparison report</h1>',
    '<ul class="meta">',
    `<li><strong>Verdict:</strong> ${e(report.verdictLabel)}</li>`,
    `<li><strong>Differences:</strong> ${e(statsLine(report))}</li>`,
  ];
  if (report.included) {
    parts.push(
      `<li><strong>Included:</strong> ${e(report.included.map((c) => CLASS_LABELS[c]).join(', '))}</li>`,
    );
  }
  parts.push(
    `<li><strong>Dialect:</strong> ${e(DIALECT_LABELS[report.options.dialect])} · <strong>Normalization:</strong> ${e(levelLabel(report.options.level))} · <strong>Parser:</strong> ${e(report.parser ?? 'none (token diff only)')}</li>`,
  );
  const names = [report.inputs.left.name, report.inputs.right.name];
  if (names.some(Boolean)) {
    parts.push(
      `<li><strong>Inputs:</strong> ${e(names[0] ?? '(pasted)')} → ${e(names[1] ?? '(pasted)')}</li>`,
    );
  }
  parts.push(`<li><strong>Generated:</strong> ${e(report.generatedAt)}</li></ul>`);

  if (report.statements.length === 0) parts.push('<p>No differences.</p>');
  for (const s of report.statements) {
    parts.push(`<h2>${e(s.label)}</h2>`);
    parts.push(
      '<table><thead><tr><th>Class</th><th>Severity</th><th>Clause</th><th>Description</th><th>Left</th><th>Right</th></tr></thead><tbody>',
    );
    for (const c of s.clauses) {
      for (const d of c.differences) {
        const notes = [
          d.resolvedBy ? `Resolved by ${d.resolvedBy.map((r) => r.title).join(', ')}` : '',
          d.l3Hint ?? '',
        ].filter(Boolean);
        parts.push(
          `<tr><td class="${d.class}">${CLASS_ICONS[d.class]} ${e(CLASS_LABELS[d.class])}</td>` +
            `<td><span class="sev ${d.severity}">${e(d.severity)}</span></td>` +
            `<td>${e(c.clause)}</td>` +
            `<td>${inlineCodeToHtml(d.description)}${notes.map((n) => `<div class="note">${e(n)}</div>`).join('')}</td>` +
            `<td class="loc">${e(where(d.left))}</td><td class="loc">${e(where(d.right))}</td></tr>`,
        );
      }
    }
    parts.push('</tbody></table>');
  }

  if (report.transformations.length > 0) {
    parts.push('<h2>Transformations applied</h2>');
    parts.push(
      '<table><thead><tr><th>Rule</th><th>Side</th><th>Statement</th><th>Edits</th><th>Example</th></tr></thead><tbody>',
    );
    for (const t of report.transformations) {
      parts.push(
        `<tr><td>${e(RULE_TITLES.get(t.rule) ?? t.rule)}</td><td>${e(t.side)}</td><td>${t.statementIndex < 0 ? 'all' : t.statementIndex + 1}</td><td>${t.count}</td>` +
          `<td><code>${e(t.before)}</code> → ${t.after ? `<code>${e(t.after)}</code>` : '(removed)'}</td></tr>`,
      );
    }
    parts.push('</tbody></table>');
  }
  if (report.normalizationIssues.length > 0) {
    parts.push('<h2>Rules not applied</h2><ul>');
    for (const i of report.normalizationIssues)
      parts.push(`<li>${e(i.side)}: ${e(i.message)}</li>`);
    parts.push('</ul>');
  }
  if (report.errors.length > 0) {
    parts.push('<h2>Parse errors</h2><ul>');
    for (const err of report.errors) {
      parts.push(
        `<li>${e(err.side)} ${err.line}:${err.column} (statement ${err.statementIndex + 1}): ${e(err.message)}</li>`,
      );
    }
    parts.push('</ul>');
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

export function renderReport(input: ReportInput, format: ReportFormat): string {
  if (format === 'markdown') return renderMarkdown(input);
  if (format === 'html') return renderHtml(input);
  return JSON.stringify(buildReport(input), null, 2);
}

export const REPORT_FILES: Record<ReportFormat, { extension: string; mime: string }> = {
  markdown: { extension: 'md', mime: 'text/markdown;charset=utf-8' },
  html: { extension: 'html', mime: 'text/html;charset=utf-8' },
  json: { extension: 'json', mime: 'application/json;charset=utf-8' },
};
