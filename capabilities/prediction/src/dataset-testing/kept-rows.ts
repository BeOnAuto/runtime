import { rowsOf, statement, WholeNumber, type HostDatabase } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { MeasureStateSchema } from '../dataset/row-measures.ts';

const KeptRowSchema = Schema.Struct({
  series: Schema.String,
  period: Schema.String,
  target: Schema.NullOr(Schema.Number),
  target_count: WholeNumber,
  events: WholeNumber,
  features: Schema.fromJsonString(Schema.Array(MeasureStateSchema)),
});

export type KeptRow = typeof KeptRowSchema.Type;

export function keptRowsOf(database: HostDatabase, dataSha256: string): Promise<readonly KeptRow[]> {
  const read = statement`SELECT series, period, target, target_count, events, features FROM prediction_rows
    WHERE data_sha256 = ${dataSha256} ORDER BY series, period_index`;
  return Effect.runPromise(rowsOf(KeptRowSchema, database.read(read)));
}
