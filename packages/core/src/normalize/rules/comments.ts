import type { NormalizationRule } from '../types.js';

/**
 * Applied by the pipeline: comments are dropped from normalized statements.
 * Optimizer hints (`/*+ … *\/`) and MySQL executable comments are not comments
 * to the lexer, so they are kept.
 */
export const comments: NormalizationRule = {
  id: 'comments',
  level: 1,
  title: 'Strip comments',
  description:
    'Comments are ignored. Optimizer hints (/*+ … */) and MySQL /*! … */ are kept as significant.',
  example: ['SELECT a -- note', 'SELECT a'],
  safety: 'safe',
  dialects: ['postgresql', 'mysql', 'generic'],
  toggleable: false,
  canonical: {},
  apply: () => null,
};
