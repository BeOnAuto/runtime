import { rowsOf, WholeNumber, type DatabaseFailed, type ReadStatement } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { composed, each } from '../dataset/dataset-statements.ts';
import type { MeasureState } from '../dataset/row-measures.ts';

export interface WindowSpan {
  readonly first: number;
  readonly last: number;
}

export interface KeptPeriod {
  readonly period: number;
  readonly target: MeasureState;
}

const HeldSchema = Schema.Struct({ period_index: WholeNumber });

const KeptSchema = Schema.Struct({
  period_index: WholeNumber,
  target: Schema.NullOr(Schema.Number),
  target_count: WholeNumber,
  target_at: Schema.NullOr(WholeNumber),
});

export function isHeldBefore(
  read: ReadStatement,
  row: DatasetRow,
  series: string,
  first: number,
): Effect.Effect<boolean, DatabaseFailed> {
  const earlier = composed(
    'SELECT period_index FROM prediction_rows WHERE playbook_key = ',
    each([row.playbookKey]),
    ' AND data_sha256 = ',
    each([row.dataSha256]),
    ' AND series = ',
    each([series]),
    ' AND period_index < ',
    each([first]),
    ' LIMIT 1',
  );
  return Effect.map(rowsOf(HeldSchema, read(earlier)), (held) => held.length > 0);
}

export function periodsOfSeries(
  read: ReadStatement,
  row: DatasetRow,
  series: string,
  { first, last }: WindowSpan,
): Effect.Effect<readonly KeptPeriod[], DatabaseFailed> {
  const periods = composed(
    'SELECT period_index, target, target_count, target_at FROM prediction_rows WHERE playbook_key = ',
    each([row.playbookKey]),
    ' AND data_sha256 = ',
    each([row.dataSha256]),
    ' AND period_index >= ',
    each([first]),
    ' AND period_index <= ',
    each([last]),
    ' AND series = ',
    each([series]),
    ' ORDER BY period_index',
  );
  return Effect.map(rowsOf(KeptSchema, read(periods)), (kept) =>
    kept.map((period) => ({
      period: period.period_index,
      target: { value: period.target, count: period.target_count, at: period.target_at },
    })),
  );
}
