import type { NormalizationRule } from '../types.js';
import { aliasAs } from './aliasAs.js';
import { comments } from './comments.js';
import { identifierCase } from './identifierCase.js';
import { joinSynonyms } from './joinSynonyms.js';
import { keywordCase } from './keywordCase.js';
import { notEqual } from './notEqual.js';
import { redundantQuotes } from './redundantQuotes.js';
import { sortBoolean } from './sortBoolean.js';
import { sortEquality } from './sortEquality.js';
import { sortFromList } from './sortFromList.js';
import { sortGroupBy } from './sortGroupBy.js';
import { sortInList } from './sortInList.js';
import { sortPartitionBy } from './sortPartitionBy.js';
import { stripParens } from './stripParens.js';
import { terminators } from './terminators.js';
import { whitespace } from './whitespace.js';

/**
 * Every rule, in the order the pipeline applies them. Not normalized on
 * purpose (they can change results): numeric literal form (1.0 vs 1.00),
 * SELECT-list order, ORDER BY items, UNION branches, outer-join order.
 */
export const RULES: readonly NormalizationRule[] = [
  whitespace,
  comments,
  terminators,
  keywordCase,
  redundantQuotes,
  identifierCase,
  joinSynonyms,
  notEqual,
  aliasAs,
  stripParens,
  sortEquality,
  sortInList,
  sortBoolean,
  sortGroupBy,
  sortPartitionBy,
  sortFromList,
];
