import { rowsOf, WholeNumber, type DatabaseFailed, type ReadStatement } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { composed, each, type Piece } from '../dataset/dataset-statements.ts';
import { MeasureStateSchema, stateOf, type MeasureState } from '../dataset/row-measures.ts';

export interface WindowSpan {
  readonly first: number;
  readonly last: number;
}

export interface WindowCount {
  readonly observed: number;
  readonly seriesInWindow: number;
}

export interface KeptPeriod {
  readonly period: number;
  readonly target: MeasureState;
  readonly features: readonly MeasureState[];
}

const SeriesSchema = Schema.Struct({ series: Schema.String });

const CountSchema = Schema.Struct({ counted: WholeNumber });

const KeptSchema = Schema.Struct({
  period_index: WholeNumber,
  target: Schema.NullOr(Schema.Number),
  target_count: WholeNumber,
  target_at: Schema.NullOr(WholeNumber),
  features: Schema.fromJsonString(Schema.Array(MeasureStateSchema)),
});

function inWindow(row: DatasetRow, { first, last }: WindowSpan): readonly Piece[] {
  return [
    ' FROM prediction_rows WHERE playbook_key = ',
    each([row.playbookKey]),
    ' AND data_sha256 = ',
    each([row.dataSha256]),
    ' AND period_index >= ',
    each([first]),
    ' AND period_index <= ',
    each([last]),
  ];
}

function observedIn(row: DatasetRow, span: WindowSpan, leastObserved: number): readonly Piece[] {
  const { as } = row.data.target;
  return [
    'SELECT series',
    ...inWindow(row, span),
    as === 'count' || as === 'sum' ? '' : ' AND target_count > 0',
    ' GROUP BY series HAVING COUNT(*) >= ',
    each([leastObserved]),
  ];
}

function countedBy(read: ReadStatement, ...pieces: readonly Piece[]): Effect.Effect<number, DatabaseFailed> {
  return Effect.map(rowsOf(CountSchema, read(composed(...pieces))), (counts) =>
    counts.reduce((total, { counted }) => total + counted, 0),
  );
}

export function windowCountOf(
  read: ReadStatement,
  row: DatasetRow,
  span: WindowSpan,
  leastObserved: number,
): Effect.Effect<WindowCount, DatabaseFailed> {
  return Effect.map(
    Effect.all([
      countedBy(read, 'SELECT COUNT(*) AS counted FROM (', ...observedIn(row, span, leastObserved), ') AS observed'),
      countedBy(read, 'SELECT COUNT(DISTINCT series) AS counted', ...inWindow(row, span)),
    ]),
    ([observed, seriesInWindow]: readonly [number, number]) => ({ observed, seriesInWindow }),
  );
}

export function observedSeriesOf(
  read: ReadStatement,
  row: DatasetRow,
  span: WindowSpan,
  leastObserved: number,
): Effect.Effect<readonly string[], DatabaseFailed> {
  return Effect.map(rowsOf(SeriesSchema, read(composed(...observedIn(row, span, leastObserved)))), (found) =>
    found.map(({ series }) => series),
  );
}

export function periodsOfSeries(
  read: ReadStatement,
  row: DatasetRow,
  series: string,
  span: WindowSpan,
): Effect.Effect<readonly KeptPeriod[], DatabaseFailed> {
  const periods = composed(
    'SELECT period_index, target, target_count, target_at, features',
    ...inWindow(row, span),
    ' AND series = ',
    each([series]),
    ' ORDER BY period_index',
  );
  return Effect.map(rowsOf(KeptSchema, read(periods)), (kept) =>
    kept.map((period) => ({
      period: period.period_index,
      target: { value: period.target, count: period.target_count, at: period.target_at },
      features: period.features.map((feature) => stateOf(feature)),
    })),
  );
}
