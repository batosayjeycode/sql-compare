import { tokenDiff } from './diff/token.js';
import type { ParserAdapter } from './parse.js';
import { splitStatements } from './split.js';
import { deriveVerdict, emptyStats } from './verdict.js';
import type {
  CompareOptions,
  ComparisonResult,
  Difference,
  ParseIssue,
  SourceRange,
  StatementInfo,
} from './types.js';

type Side = 'left' | 'right';

/** 1-based line and column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

function analyzeSide(
  side: Side,
  text: string,
  options: CompareOptions,
  parser: ParserAdapter | null,
  errors: ParseIssue[],
): StatementInfo[] {
  return splitStatements(text, options.dialect).map((stmt) => {
    const info: StatementInfo = {
      index: stmt.index,
      start: stmt.start,
      end: stmt.end,
      kind: stmt.kind,
      status: 'skipped',
    };
    if (!parser) return info;
    const parsed = parser.parse(stmt);
    if (parsed.status === 'parsed') return { ...info, status: 'parsed' };
    if (parsed.status === 'unsupported') {
      return { ...info, status: 'unsupported', message: parsed.reason };
    }
    const offset = stmt.start + Math.min(parsed.offset, stmt.text.length);
    errors.push({
      side,
      statementIndex: stmt.index,
      message: parsed.message,
      offset,
      ...lineColumn(text, offset),
    });
    return { ...info, status: 'error', message: parsed.message };
  });
}

/** Statements a source range touches (an empty range touches the statement containing it). */
function overlapping(statements: StatementInfo[], range: SourceRange | undefined) {
  if (!range) return [];
  return statements.filter((s) =>
    range.start === range.end
      ? s.start <= range.start && range.start <= s.end
      : s.start < range.end && range.start < s.end,
  );
}

const UNANALYZABLE = new Set(['error', 'unsupported']);

/**
 * Compare two SQL inputs.
 *
 * Every difference is either `formatting` (whitespace, comments, keyword case)
 * or potentially `semantic`. Potentially semantic changes inside a statement
 * that couldn't be parsed are `unknown` (PLAN §5.5 step 5): there is no
 * structural analysis for them, only the token diff. Normalization
 * (structural) and AST diff arrive in M4–M5.
 */
export function compare(
  left: string,
  right: string,
  options: CompareOptions,
  parser: ParserAdapter | null = null,
): ComparisonResult {
  const errors: ParseIssue[] = [];
  const statements = {
    left: analyzeSide('left', left, options, parser, errors),
    right: analyzeSide('right', right, options, parser, errors),
  };

  const differences: Difference[] = (
    left === right ? [] : tokenDiff(left, right, options.dialect)
  ).map((d) => {
    const l = overlapping(statements.left, d.left);
    const r = overlapping(statements.right, d.right);
    const statementPair = l[0]?.index ?? r[0]?.index ?? 0;
    const unanalyzable = [...l, ...r].some((s) => UNANALYZABLE.has(s.status));
    return {
      ...d,
      statementPair,
      class: d.class === 'semantic' && unanalyzable ? 'unknown' : d.class,
    };
  });

  const stats = emptyStats();
  for (const d of differences) stats[d.class]++;
  return {
    verdict: deriveVerdict(stats),
    stats,
    differences,
    transformations: [],
    errors,
    statements,
    parser: parser?.name ?? null,
    views: { left: { original: left }, right: { original: right } },
  };
}
