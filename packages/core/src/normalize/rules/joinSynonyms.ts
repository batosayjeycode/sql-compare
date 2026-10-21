import { word } from '../structure.js';
import type { NormalizationRule } from '../types.js';
import { diffResult } from './util.js';

export const joinSynonyms: NormalizationRule = {
  id: 'join-synonyms',
  level: 2,
  title: 'Canonical join keywords',
  description: 'INNER JOIN → JOIN; LEFT/RIGHT/FULL OUTER JOIN → LEFT/RIGHT/FULL JOIN.',
  example: ['a INNER JOIN b … LEFT OUTER JOIN c', 'a JOIN b … LEFT JOIN c'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql'],
  toggleable: true,
  canonical: {},
  apply(tokens) {
    const after = tokens.filter((t, i) => {
      const w = word(t);
      const next = word(tokens[i + 1]);
      if (w === 'INNER' && next === 'JOIN') return false;
      const prev = word(tokens[i - 1]);
      if (
        w === 'OUTER' &&
        next === 'JOIN' &&
        (prev === 'LEFT' || prev === 'RIGHT' || prev === 'FULL')
      ) {
        return false;
      }
      return true;
    });
    return diffResult(tokens, after);
  },
};
