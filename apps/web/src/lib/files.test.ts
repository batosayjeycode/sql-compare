import { describe, expect, it } from 'vitest';
import {
  decodeBytes,
  FileLoadError,
  isAcceptedFileName,
  loadSqlFile,
  SOFT_SIZE_LIMIT,
} from './files';

const utf8 = (s: string) => new TextEncoder().encode(s);

function utf16(s: string, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2);
  out.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const [hi, lo] = [code >> 8, code & 0xff];
    out.set(bigEndian ? [hi, lo] : [lo, hi], 2 + i * 2);
  }
  return out;
}

describe('isAcceptedFileName', () => {
  it('accepts .sql, .txt and .ddl case-insensitively', () => {
    expect(isAcceptedFileName('query.sql')).toBe(true);
    expect(isAcceptedFileName('NOTES.TXT')).toBe(true);
    expect(isAcceptedFileName('schema.ddl')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(isAcceptedFileName('image.png')).toBe(false);
    expect(isAcceptedFileName('sql')).toBe(false);
  });
});

describe('decodeBytes', () => {
  it('decodes plain UTF-8', () => {
    expect(decodeBytes(utf8("SELECT 'café'"))).toEqual({
      text: "SELECT 'café'",
      encoding: 'utf-8',
    });
  });

  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('SELECT 1')]);
    expect(decodeBytes(bytes)).toEqual({ text: 'SELECT 1', encoding: 'utf-8' });
  });

  it('detects UTF-16 LE and BE by BOM', () => {
    expect(decodeBytes(utf16('SELECT ñ', false))).toEqual({
      text: 'SELECT ñ',
      encoding: 'utf-16le',
    });
    expect(decodeBytes(utf16('SELECT ñ', true))).toEqual({
      text: 'SELECT ñ',
      encoding: 'utf-16be',
    });
  });

  it('falls back to Windows-1252 for invalid UTF-8', () => {
    // 0xE9 is "é" in Windows-1252 but an invalid lone byte in UTF-8.
    const bytes = new Uint8Array([...utf8("SELECT 'caf"), 0xe9, ...utf8("'")]);
    expect(decodeBytes(bytes)).toEqual({ text: "SELECT 'café'", encoding: 'windows-1252' });
  });
});

describe('loadSqlFile', () => {
  it('rejects unsupported file types with a friendly error', async () => {
    const file = new File(['x'], 'photo.png');
    await expect(loadSqlFile(file)).rejects.toThrow(FileLoadError);
    await expect(loadSqlFile(file)).rejects.toThrow(/isn't a supported file type/);
  });

  it('loads a file with its name and no warnings', async () => {
    const loaded = await loadSqlFile(new File(['SELECT 1;'], 'a.sql'));
    expect(loaded).toMatchObject({ name: 'a.sql', text: 'SELECT 1;', warnings: [] });
  });

  it('warns but still loads files above the soft size limit', async () => {
    const big = new File(['-'.repeat(SOFT_SIZE_LIMIT + 1)], 'big.sql');
    const loaded = await loadSqlFile(big);
    expect(loaded.text.length).toBe(SOFT_SIZE_LIMIT + 1);
    expect(loaded.warnings[0]).toMatch(/Large files may make comparison slow/);
  });
});
