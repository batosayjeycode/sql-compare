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
export { splitStatements, type Statement } from './split.js';
export { loadParser, type ParserAdapter, type StatementParse } from './parse.js';

export const DEFAULT_OPTIONS: CompareOptions = {
  dialect: 'postgresql',
  level: 2,
};

export const SUPPORTED_DIALECTS = [
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL / MariaDB' },
  { id: 'generic', label: 'Generic (format + token diff)' },
] as const;
