import type { SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { closedRecord, label, shapeOf, type OutputShape } from './output-shape.ts';
import { issueAt, isList, itemsOf, recordOf, repeatedNameIssues } from './shape-values.ts';

const tableBounds = { mostColumns: 50, mostRows: 500 } as const;

const column = closedRecord({ name: label, unit: label }, ['name']);

const cell = { type: ['string', 'number', 'boolean', 'null'] };

function cellsWords(width: number): string {
  return width === 1 ? '1 cell, for its one column' : `${width} cells, one for each column`;
}

function widthIssues(row: Schema.Json, index: number, width: number): readonly SchemaIssue[] {
  return isList(row) && row.length !== width ? [issueAt(['rows', index], `Expected ${cellsWords(width)}`)] : [];
}

function tableIssues(value: Schema.Json): readonly SchemaIssue[] {
  const table = recordOf(value);
  const columns = itemsOf(table['columns']);
  const rows = columns.length === 0 ? [] : itemsOf(table['rows']);
  return [
    ...repeatedNameIssues(columns, ['columns'], 'column'),
    ...rows.flatMap((row, index) => widthIssues(row, index, columns.length)),
  ];
}

export const tableShape: OutputShape = shapeOf({
  name: 'table',
  properties: {
    columns: { type: 'array', items: column, minItems: 1, maxItems: tableBounds.mostColumns },
    rows: {
      type: 'array',
      description: 'Each row is a list of one cell for each column, in the order of columns',
      items: { type: 'array', items: cell, maxItems: tableBounds.mostColumns },
      maxItems: tableBounds.mostRows,
    },
  },
  required: ['columns', 'rows'],
  further: tableIssues,
});
