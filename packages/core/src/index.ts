import type { CompareOptions } from './types.js';

export * from './types.js';
export { deriveVerdict, emptyStats } from './verdict.js';
export { tokenize, isTrivia, type Token, type TokenType } from './tokenize.js';
export { caseInsensitiveWords, tokenKey } from './keywords.js';
export {
  formatSql,
  significantKeys,
  DEFAULT_FORMAT_OPTIONS,
  type FormatOptions,
  type FormatResult,
  type KeywordCase,
} from './format.js';
export { tokenDiff } from './diff/token.js';
export { compare, lineColumn } from './compare.js';
export { SEVERITY, type Aspect } from './diff/severity.js';
export { code } from './diff/text.js';
export { createViewMapper, type ViewMapper, type ViewSource } from './views.js';
export {
  buildReport,
  clauseOf,
  CLASS_ICONS,
  CLASS_LABELS,
  groupDifferences,
  inlineCodeToHtml,
  splitCodeSpans,
  pairLabel,
  renderReport,
  REPORT_FILES,
  VERDICT_LABELS,
  type DifferenceGroup,
  type Report,
  type ReportFormat,
  type ReportInput,
} from './report.js';
export { splitStatements, type Statement } from './split.js';
export {
  loadParser,
  type CanonicalMode,
  type ParserAdapter,
  type StatementParse,
} from './parse.js';
export { RULES, printTokens, type NormalizationRule } from './normalize/index.js';

export const DEFAULT_OPTIONS: CompareOptions = {
  dialect: 'postgresql',
  level: 2,
};

export const SUPPORTED_DIALECTS = [
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL / MariaDB' },
  { id: 'generic', label: 'Generic (format + token diff)' },
] as const;
