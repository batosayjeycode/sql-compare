import type { Dialect } from './types.js';

/**
 * Dialect-aware SQL lexer. Lossless: concatenating every token's text gives
 * back the input. Used for the token diff and the formatter safety check.
 */

export type TokenType =
  | 'whitespace'
  | 'line-comment'
  | 'block-comment'
  /** Optimizer hint (`/*+ … *\/`) or MySQL executable comment (`/*! … *\/`). Significant. */
  | 'hint'
  | 'string'
  | 'quoted-identifier'
  | 'number'
  | 'word'
  | 'variable'
  | 'operator'
  | 'punctuation';

export interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
}

/** Whitespace and comments: tokens that never affect what a query does. */
export function isTrivia(token: Token): boolean {
  return (
    token.type === 'whitespace' || token.type === 'line-comment' || token.type === 'block-comment'
  );
}

// Longest match first.
const MULTI_CHAR_OPERATORS = [
  '<=>',
  '->>',
  '#>>',
  '!~*',
  '<>',
  '!=',
  '<=',
  '>=',
  '::',
  '||',
  '->',
  '#>',
  '@>',
  '<@',
  '&&',
  ':=',
  '<<',
  '>>',
  '=>',
  '!~',
  '~*',
  '?|',
  '?&',
];
const OPERATOR_CHARS = '+-*/<>=~!@#%^&|`?:';
const PUNCTUATION_CHARS = '(),;.[]{}';

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isWordStart = (c: string | undefined) =>
  c !== undefined && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80);
const isWordChar = (c: string | undefined) =>
  c !== undefined && (/[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) >= 0x80);
const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);

/** Index just past a quoted run starting at `start` (the opening quote). Unterminated → EOF. */
function scanQuoted(sql: string, start: number, quote: string, backslash: boolean): number {
  let i = start + 1;
  while (i < sql.length) {
    const c = sql[i];
    if (backslash && c === '\\') {
      i += 2;
    } else if (c === quote) {
      if (sql[i + 1] === quote) i += 2;
      else return i + 1;
    } else {
      i++;
    }
  }
  return sql.length;
}

function scanBlockComment(sql: string, start: number, nested: boolean): number {
  let depth = 1;
  let i = start + 2;
  while (i < sql.length) {
    if (sql.startsWith('*/', i)) {
      depth--;
      i += 2;
      if (depth === 0 || !nested) return i;
    } else if (nested && sql.startsWith('/*', i)) {
      depth++;
      i += 2;
    } else {
      i++;
    }
  }
  return sql.length;
}

/** `$tag$ … $tag$` (PostgreSQL). Returns the end index, or -1 if `start` isn't a dollar quote. */
function scanDollarQuote(sql: string, start: number): number {
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start, start + 64));
  if (!m) return -1;
  const close = sql.indexOf(m[0], start + m[0].length);
  return close === -1 ? sql.length : close + m[0].length;
}

function scanNumber(sql: string, start: number): number {
  let i = start;
  if (sql[i] === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X')) {
    i += 2;
    while (i < sql.length && /[0-9a-fA-F]/.test(sql[i] ?? '')) i++;
    return i;
  }
  while (isDigit(sql[i])) i++;
  if (sql[i] === '.' && sql[i + 1] !== '.') {
    i++;
    while (isDigit(sql[i])) i++;
  }
  if (
    (sql[i] === 'e' || sql[i] === 'E') &&
    (isDigit(sql[i + 1]) || /[+-]/.test(sql[i + 1] ?? ''))
  ) {
    const j = isDigit(sql[i + 1]) ? i + 1 : i + 2;
    if (isDigit(sql[j])) {
      i = j;
      while (isDigit(sql[i])) i++;
    }
  }
  return i;
}

export function tokenize(sql: string, dialect: Dialect): Token[] {
  const mysql = dialect === 'mysql';
  const postgres = dialect === 'postgresql';
  const tokens: Token[] = [];
  let i = 0;

  const push = (type: TokenType, end: number) => {
    tokens.push({ type, text: sql.slice(i, end), start: i, end });
    i = end;
  };

  while (i < sql.length) {
    const c = sql[i] as string;
    const next = sql[i + 1];

    if (isSpace(c)) {
      let j = i + 1;
      while (isSpace(sql[j])) j++;
      push('whitespace', j);
      continue;
    }

    // MySQL only treats `--` as a comment when followed by whitespace or EOF.
    const dashComment =
      c === '-' &&
      next === '-' &&
      (!mysql || next === undefined || sql[i + 2] === undefined || isSpace(sql[i + 2]));
    if (dashComment || (mysql && c === '#')) {
      const nl = sql.indexOf('\n', i);
      push('line-comment', nl === -1 ? sql.length : nl);
      continue;
    }

    if (c === '/' && next === '*') {
      const third = sql[i + 2];
      const hint = third === '+' || (mysql && third === '!');
      push(hint ? 'hint' : 'block-comment', scanBlockComment(sql, i, postgres));
      continue;
    }

    // Prefixed strings: E'…' (backslash escapes), B'…', X'…', N'…', U&'…'.
    if (/[EeBbXxNn]/.test(c) && next === "'") {
      const backslash = c === 'E' || c === 'e' || mysql;
      push('string', scanQuoted(sql, i + 1, "'", backslash));
      continue;
    }
    if ((c === 'U' || c === 'u') && next === '&' && sql[i + 2] === "'") {
      const end = scanQuoted(sql, i + 2, "'", false);
      push('string', end);
      continue;
    }

    if (c === "'") {
      push('string', scanQuoted(sql, i, "'", mysql));
      continue;
    }

    if (c === '"') {
      push(mysql ? 'string' : 'quoted-identifier', scanQuoted(sql, i, '"', mysql));
      continue;
    }

    if (c === '`' && (mysql || dialect === 'generic')) {
      push('quoted-identifier', scanQuoted(sql, i, '`', false));
      continue;
    }

    if (c === '$') {
      if (postgres || dialect === 'generic') {
        const end = scanDollarQuote(sql, i);
        if (end !== -1) {
          push('string', end);
          continue;
        }
      }
      if (isDigit(next)) {
        let j = i + 1;
        while (isDigit(sql[j])) j++;
        push('variable', j);
        continue;
      }
    }

    if (mysql && c === '@') {
      let j = i + 1;
      if (sql[j] === '@') j++;
      const q = sql[j];
      if (q === "'" || q === '"' || q === '`') {
        push('variable', scanQuoted(sql, j, q, q !== '`'));
        continue;
      }
      if (isWordChar(q)) {
        while (isWordChar(sql[j]) || sql[j] === '.') j++;
        push('variable', j);
        continue;
      }
    }

    if (isDigit(c) || (c === '.' && isDigit(next))) {
      push('number', scanNumber(sql, i));
      continue;
    }

    if (isWordStart(c)) {
      let j = i + 1;
      while (isWordChar(sql[j])) j++;
      push('word', j);
      continue;
    }

    if (PUNCTUATION_CHARS.includes(c)) {
      push('punctuation', i + 1);
      continue;
    }

    const op = MULTI_CHAR_OPERATORS.find((o) => sql.startsWith(o, i));
    if (op) {
      push('operator', i + op.length);
      continue;
    }
    push(OPERATOR_CHARS.includes(c) ? 'operator' : 'punctuation', i + 1);
  }

  return tokens;
}
