import { beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import { loadParser, type ParserAdapter } from '../src/parse.js';
import type { ComparisonResult, Dialect } from '../src/types.js';
import { CORPUS } from './golden/corpus.js';

const parsers = new Map<Dialect, ParserAdapter>();

beforeAll(async () => {
  for (const dialect of ['postgresql', 'mysql'] as const) {
    parsers.set(dialect, (await loadParser(dialect))!);
  }
});

const describeDiffs = (result: ComparisonResult) =>
  result.differences
    .filter((d) => d.class !== 'formatting')
    .map((d) => `${d.class} ${d.kind} ${d.severity}: ${d.description}${d.l3Hint ? ' [L3]' : ''}`);

const flip = { added: 'removed', removed: 'added', changed: 'changed', moved: 'moved' } as const;

for (const dialect of ['postgresql', 'mysql'] as const) {
  describe(`golden corpus (${dialect})`, () => {
    const cases = CORPUS.filter((c) => !c.only || c.only === dialect);

    it.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
      const options = { dialect, level: c.level ?? 2 } as const;
      const result = compare(c.left, c.right, options, parsers.get(dialect)!);

      const expectsUnparsed = c.diffs.some((d) => d.startsWith('unknown'));
      if (!expectsUnparsed) expect(result.errors).toEqual([]);
      expect(describeDiffs(result)).toEqual(c.diffs);
      expect(result.verdict).toBe(c.verdict);

      // Every difference points at real source ranges on both sides.
      for (const d of result.differences) {
        for (const [range, text] of [
          [d.left, c.left],
          [d.right, c.right],
        ] as const) {
          expect(range, d.description).toBeDefined();
          expect(range!.start).toBeGreaterThanOrEqual(0);
          expect(range!.end).toBeLessThanOrEqual(text.length);
          expect(range!.start).toBeLessThanOrEqual(range!.end);
        }
        if (d.class === 'semantic' || d.class === 'unknown') {
          expect(d.path.length, d.description).toBeGreaterThan(0);
        }
      }
      if (c.ranges) {
        const semantic = result.differences.filter((d) => d.class === 'semantic');
        expect(
          semantic.map((d) => [
            c.left.slice(d.left!.start, d.left!.end),
            c.right.slice(d.right!.start, d.right!.end),
          ]),
        ).toEqual(c.ranges);
      }

      // Symmetry (PLAN §8 property f): B vs A mirrors A vs B.
      const reverse = compare(c.right, c.left, options, parsers.get(dialect)!);
      expect(reverse.stats).toEqual(result.stats);
      const kinds = (r: ComparisonResult, mirror: boolean) =>
        r.differences
          .map((d) => `${d.class}:${mirror ? flip[d.kind] : d.kind}:${d.severity}`)
          .sort();
      expect(kinds(reverse, false)).toEqual(kinds(result, true));
    });
  });
}
