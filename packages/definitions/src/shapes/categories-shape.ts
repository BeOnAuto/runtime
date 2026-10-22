import type { SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { amount, closedRecord, highest, label, lowest, shapeOf, type OutputShape } from './output-shape.ts';
import { itemsOf, rangeIssues, recordOf, repeatedNameIssues } from './shape-values.ts';

const categoriesBounds = { mostValues: 200 } as const;

const category = closedRecord({ name: label, value: amount, low: lowest, high: highest }, ['name', 'value']);

function categoriesIssues(value: Schema.Json): readonly SchemaIssue[] {
  const values = itemsOf(recordOf(value)['values']);
  return [
    ...repeatedNameIssues(values, ['values'], 'value'),
    ...values.flatMap((entry, index) => rangeIssues(entry, ['values', index])),
  ];
}

export const categoriesShape: OutputShape = shapeOf({
  name: 'categories',
  properties: {
    unit: label,
    values: { type: 'array', items: category, minItems: 1, maxItems: categoriesBounds.mostValues },
  },
  required: ['values'],
  further: categoriesIssues,
});
