import {
  chunksWithin,
  rowsOf,
  WholeNumber,
  type DatabaseFailed,
  type HostDatabase,
  type Statement,
  type StatementValue,
} from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import type { DatasetData } from './dataset-data.ts';
import type { DatasetRow } from './dataset-rows.ts';
import { composed, each, tuples } from './dataset-statements.ts';
import type { Contribution } from './event-values.ts';
import { emptyMeasure, measureTaken, type MeasureState } from './row-measures.ts';

export interface MergedRow {
  readonly series: string;
  readonly period: number;
  readonly target: MeasureState;
  readonly events: number;
}

export interface Merged {
  readonly rows: readonly MergedRow[];
  readonly newRows: number;
  readonly newSeries: number;
}

const StoredRowSchema = Schema.Struct({
  series: Schema.String,
  period_index: WholeNumber,
  target: Schema.NullOr(Schema.Number),
  target_count: WholeNumber,
  target_at: Schema.NullOr(WholeNumber),
  events: WholeNumber,
});

const SeriesSchema = Schema.Struct({ series: Schema.String });

type StoredRow = typeof StoredRowSchema.Type;

function keyOf(series: string, period: number): string {
  return JSON.stringify([series, period]);
}

function emptyRow(data: DatasetData, series: string, period: number): MergedRow {
  return { series, period, target: emptyMeasure(data.target.as), events: 0 };
}

function taken(data: DatasetData, row: MergedRow, contribution: Contribution): MergedRow {
  const { moment } = contribution;
  return {
    ...row,
    target: measureTaken(row.target, data.target.as, contribution.target, moment),
    events: row.events + 1,
  };
}

type Database = Pick<HostDatabase, 'read' | 'mostBoundValues'>;

const valuesOfTheDataset = 2;

function readInChunks<Item, Row>(
  { read, mostBoundValues }: Database,
  items: readonly Item[],
  { valuesEach, rowSchema }: { readonly valuesEach: number; readonly rowSchema: Schema.Codec<Row, unknown> },
  statementOf: (chunk: readonly Item[]) => Statement,
): Effect.Effect<readonly Row[], DatabaseFailed> {
  const chunks = chunksWithin(items, { mostBoundValues, valuesEach, valuesBeside: valuesOfTheDataset });
  return Effect.map(
    Effect.forEach(chunks, (chunk) => rowsOf(rowSchema, read(statementOf(chunk)))),
    (chunked: readonly (readonly Row[])[]) => chunked.flat(),
  );
}

function existingRows(database: Database, row: DatasetRow, contributions: readonly Contribution[]) {
  const series = [...new Set(contributions.map(({ series: named }) => named))];
  const touched = new Map(contributions.map(({ series: named, period }) => [keyOf(named, period), [named, period]]));
  const where = [' WHERE playbook_key = ', each([row.playbookKey]), ' AND data_sha256 = ', each([row.dataSha256])];
  const kept = (pairs: readonly (readonly StatementValue[])[]) =>
    composed(
      'SELECT series, period_index, target, target_count, target_at, events FROM prediction_rows',
      ...where,
      ' AND (series, period_index) IN (',
      ...tuples(pairs),
      ')',
    );
  const known = (named: readonly string[]) =>
    composed(
      'WITH probe (series) AS (VALUES ',
      ...tuples(named.map((one) => [one])),
      ') SELECT series FROM probe WHERE (SELECT 1 FROM prediction_rows',
      ...where,
      ' AND prediction_rows.series = probe.series LIMIT 1) IS NOT NULL',
    );
  return Effect.all([
    readInChunks(database, [...touched.values()], { valuesEach: 2, rowSchema: StoredRowSchema }, kept),
    readInChunks(database, series, { valuesEach: 1, rowSchema: SeriesSchema }, known),
  ]);
}

export function mergedRows(
  database: Database,
  row: DatasetRow,
  contributions: readonly Contribution[],
): Effect.Effect<Merged, DatabaseFailed> {
  if (contributions.length === 0) {
    return Effect.succeed({ rows: [], newRows: 0, newSeries: 0 });
  }
  return Effect.map(
    existingRows(database, row, contributions),
    ([stored, known]: readonly [readonly StoredRow[], readonly { readonly series: string }[]]) => {
      const merged = new Map(
        stored.map((kept): readonly [string, MergedRow] => [
          keyOf(kept.series, kept.period_index),
          {
            series: kept.series,
            period: kept.period_index,
            target: { value: kept.target, count: kept.target_count, at: kept.target_at },
            events: kept.events,
          },
        ]),
      );
      const before = merged.size;
      for (const contribution of contributions) {
        const key = keyOf(contribution.series, contribution.period);
        const current = merged.get(key) ?? emptyRow(row.data, contribution.series, contribution.period);
        merged.set(key, taken(row.data, current, contribution));
      }
      const knownSeries = new Set(known.map(({ series }) => series));
      const newSeries = new Set(contributions.map(({ series }) => series).filter((series) => !knownSeries.has(series)));
      return { rows: [...merged.values()], newRows: merged.size - before, newSeries: newSeries.size };
    },
  );
}
