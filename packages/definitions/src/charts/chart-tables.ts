import type { Schema } from 'effect';

import { chronologically } from '../shapes/period-forms.ts';
import type { OutputShapeName } from '../shapes/shape-names.ts';
import { itemsOf, recordOf } from '../shapes/shape-values.ts';

type Json = Schema.Json;

export function plainText(value: Json | undefined): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function cellText(cell: Json | undefined): string {
  return plainText(cell).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/gu, ' ');
}

function tableLine(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function markdownTable(header: readonly string[], rows: readonly (readonly (Json | undefined)[])[]): string {
  return [
    tableLine(header.map((name) => cellText(name))),
    tableLine(header.map(() => '---')),
    ...rows.map((row) => tableLine(header.map((_, index) => cellText(row[index])))),
  ].join('\n');
}

function valueAt(entry: Schema.JsonObject, at: string): Json | undefined {
  return itemsOf(entry['points'])
    .map((point) => recordOf(point))
    .find((point) => point['at'] === at)?.['value'];
}

function seriesTable(series: Schema.JsonObject): string {
  const lines = itemsOf(series['lines']).map((entry) => recordOf(entry));
  const ats = [
    ...new Set(lines.flatMap((entry) => itemsOf(entry['points']).map((point) => plainText(recordOf(point)['at'])))),
  ];
  const ordered = ats.toSorted(chronologically(series['period']));
  return markdownTable(
    ['at', ...lines.map((entry) => plainText(entry['name']))],
    ordered.map((at) => Array.of<Json | undefined>(at, ...lines.map((entry) => valueAt(entry, at)))),
  );
}

function categoriesTable(categories: Schema.JsonObject): string {
  const values = itemsOf(categories['values']).map((entry) => recordOf(entry));
  const ranged = ['low', 'high'].filter((bound) => values.some((value) => value[bound] !== undefined));
  const header = ['name', 'value', ...ranged];
  return markdownTable(
    header,
    values.map((value) => header.map((field) => value[field])),
  );
}

function tableTable(table: Schema.JsonObject): string {
  return markdownTable(
    itemsOf(table['columns']).map((column) => plainText(recordOf(column)['name'])),
    itemsOf(table['rows']).map((row) => itemsOf(row)),
  );
}

export function tableOf(shape: OutputShapeName, data: Json): string {
  const record = recordOf(data);
  if (shape === 'series') {
    return seriesTable(record);
  }
  if (shape === 'categories') {
    return categoriesTable(record);
  }
  return shape === 'table' ? tableTable(record) : plainText(record['text']);
}
