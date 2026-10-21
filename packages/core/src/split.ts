import { isTrivia, tokenize, type Token } from './tokenize.js';
import type { Dialect } from './types.js';

/**
 * Dialect-aware statement splitter (PLAN §5.5 step 1).
 *
 * Built on the lexer, so `;` inside strings, comments, quoted identifiers and
 * PostgreSQL dollar-quoted bodies never splits. Also handles:
 * - MySQL `DELIMITER` changes (the DELIMITER line itself is not a statement)
 * - stored-program bodies (`CREATE PROCEDURE … BEGIN … END`, MariaDB
 *   `BEGIN NOT ATOMIC`, PostgreSQL `BEGIN ATOMIC`) written without DELIMITER
 * - psql meta-commands (`\set`, `\i file`), which end at the end of the line
 */

export interface Statement {
  index: number;
  /** Start of the first significant token (leading comments excluded). */
  start: number;
  /** End of the last significant token before the terminator. */
  end: number;
  text: string;
  /** `;`, a custom DELIMITER, or null at end of input / psql meta-command. */
  terminator: string | null;
  /** Leading keyword(s), upper-cased: "SELECT", "CREATE TABLE", … */
  kind: string;
  /** Procedural block or client command: compared as text, never parsed structurally. */
  opaque: 'compound' | 'psql-meta' | null;
}

const OBJECT_KEYWORDS = new Set([
  'TABLE',
  'VIEW',
  'INDEX',
  'FUNCTION',
  'PROCEDURE',
  'TRIGGER',
  'EVENT',
  'SCHEMA',
  'DATABASE',
  'SEQUENCE',
  'TYPE',
  'EXTENSION',
  'ROLE',
  'USER',
  'DOMAIN',
  'POLICY',
]);
const STORED_PROGRAMS = new Set(['PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT']);
/** `END IF` etc. close blocks the splitter doesn't count. */
const UNCOUNTED_END = new Set(['IF', 'LOOP', 'WHILE', 'REPEAT']);

function statementKind(words: string[]): string {
  const [first, ...rest] = words;
  if (!first) return '';
  if (first === 'CREATE' || first === 'ALTER' || first === 'DROP') {
    const object = rest.find((w) => OBJECT_KEYWORDS.has(w));
    return object ? `${first} ${object}` : first;
  }
  return first;
}

interface Open {
  firstToken: Token;
  lastToken: Token;
  words: string[];
  storedProgram: boolean;
  depth: number;
  compound: boolean;
}

export function splitStatements(sql: string, dialect: Dialect): Statement[] {
  const tokens = tokenize(sql, dialect);
  const statements: Statement[] = [];
  const mysql = dialect === 'mysql';
  const postgres = dialect === 'postgresql';
  let delimiter = ';';
  let open: Open | null = null;

  const nextWord = (from: number): string | undefined => {
    for (let j = from + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (isTrivia(t)) continue;
      return t.type === 'word' ? t.text.toUpperCase() : t.text;
    }
    return undefined;
  };

  const lineEnd = (from: number) => {
    const nl = sql.indexOf('\n', from);
    return nl === -1 ? sql.length : nl;
  };

  /** Index of the first token starting at or after `offset`. */
  const tokenAt = (offset: number, from: number) => {
    let j = from;
    while (j < tokens.length && tokens[j]!.start < offset) j++;
    return j;
  };

  const close = (terminator: string | null, opaque: Statement['opaque'] = null, end?: number) => {
    if (!open) return;
    const start = open.firstToken.start;
    const stop = end ?? open.lastToken.end;
    statements.push({
      index: statements.length,
      start,
      end: stop,
      text: sql.slice(start, stop),
      terminator,
      kind: statementKind(open.words),
      opaque: opaque ?? (open.compound ? 'compound' : null),
    });
    open = null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isTrivia(t)) continue;
    const upper = t.type === 'word' ? t.text.toUpperCase() : '';

    if (!open) {
      // MySQL client command: DELIMITER <string> (to end of line).
      if (mysql && upper === 'DELIMITER' && tokens[i + 1]?.type === 'whitespace') {
        const end = lineEnd(t.end);
        const value = sql.slice(t.end, end).trim().split(/\s+/)[0];
        if (value) {
          delimiter = value;
          i = tokenAt(end, i) - 1;
          continue;
        }
      }
      // psql meta-command: backslash at statement start, runs to end of line.
      if (postgres && t.text === '\\') {
        const end = lineEnd(t.end);
        const j = tokenAt(end, i);
        let last = t;
        for (let k = i; k < j; k++) if (!isTrivia(tokens[k]!)) last = tokens[k]!;
        open = {
          firstToken: t,
          lastToken: last,
          words: ['\\' + (sql.slice(t.end, end).trim().split(/\s+/)[0] ?? '')],
          storedProgram: false,
          depth: 0,
          compound: false,
        };
        close(null, 'psql-meta');
        i = j - 1;
        continue;
      }
      open = {
        firstToken: t,
        lastToken: t,
        words: [],
        storedProgram: false,
        depth: 0,
        compound: false,
      };
    }

    // Custom delimiter (MySQL). Identifiers may contain `$`, so a delimiter
    // like `$$` can sit inside a token (`END$$`): match anywhere in it.
    if (delimiter !== ';' && t.type !== 'string' && t.type !== 'quoted-identifier') {
      const at = sql.indexOf(delimiter, t.start);
      if (at !== -1 && at < t.end) {
        if (at > t.start) close(delimiter, null, at);
        else if (open.firstToken === t) open = null;
        else close(delimiter);
        i = tokenAt(at + delimiter.length, i) - 1;
        continue;
      }
    }

    if (delimiter === ';' && t.text === ';' && open.depth === 0) {
      if (open.firstToken === t) open = null;
      else close(';');
      continue;
    }

    open.lastToken = t;
    if (!upper) continue;
    if (open.words.length < 8) open.words.push(upper);
    if (open.words[0] === 'CREATE' && STORED_PROGRAMS.has(upper)) open.storedProgram = true;

    if (upper === 'BEGIN') {
      const next = nextWord(i);
      const anonymousBlock = open.words.length === 1 && next === 'NOT'; // MariaDB BEGIN NOT ATOMIC
      const body = open.storedProgram && next !== ';' && next !== 'WORK' && next !== 'TRANSACTION';
      if (anonymousBlock || body || (open.depth > 0 && next !== ';')) {
        open.depth++;
        open.compound = true;
      }
    } else if (open.depth > 0 && upper === 'CASE') {
      open.depth++;
    } else if (open.depth > 0 && upper === 'END') {
      const next = nextWord(i);
      if (!next || !UNCOUNTED_END.has(next)) open.depth--;
    }
  }
  close(null);
  return statements;
}
