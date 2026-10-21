import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, deriveVerdict, emptyStats } from '../src/index.js';

describe('defaults', () => {
  it('uses PostgreSQL with L2 normalization', () => {
    expect(DEFAULT_OPTIONS).toEqual({ dialect: 'postgresql', level: 2 });
  });
});

describe('deriveVerdict', () => {
  it('is identical when there are no diffs', () => {
    expect(deriveVerdict(emptyStats())).toBe('identical');
  });

  it('ranks semantic above everything else', () => {
    expect(deriveVerdict({ formatting: 3, structural: 2, semantic: 1, unknown: 1 })).toBe(
      'potentially-semantic',
    );
  });

  it('reports unknown when only unparseable diffs remain beyond structural', () => {
    expect(deriveVerdict({ ...emptyStats(), structural: 1, unknown: 1 })).toBe('unknown');
  });

  it('reports structural-only and formatting-only', () => {
    expect(deriveVerdict({ ...emptyStats(), formatting: 4, structural: 1 })).toBe(
      'structural-only',
    );
    expect(deriveVerdict({ ...emptyStats(), formatting: 4 })).toBe('formatting-only');
  });
});
