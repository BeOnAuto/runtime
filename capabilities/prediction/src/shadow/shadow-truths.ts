import type { PlaybookAddress } from '@on.auto/operations';
import { rowsOf, WholeNumber } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { composed, each } from '../dataset/dataset-statements.ts';
import { cellOf } from '../dataset/row-measures.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { datasetRead } from '../files/build-reads.ts';
import type { ShadowTarget } from './shadow-schedule.ts';

const TargetSchema = Schema.Struct({
  series: Schema.String,
  target: Schema.NullOr(Schema.Number),
  target_count: WholeNumber,
  target_at: Schema.NullOr(WholeNumber),
});

type Truths = ReadonlyMap<string, number>;

export interface Truthful {
  readonly truths: Truths;
  readonly absentIsZero: boolean;
}

export function truthsOf(
  ports: PredictionPorts,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  { first, last }: ShadowTarget,
): Effect.Effect<Truthful> {
  const request = { database: ports.database, content: ports.ledger.content, playbook, document, now: 0 };
  return ports.database
    .readConsistently((read) =>
      Effect.gen(function* () {
        const row = yield* datasetRead(read, request);
        const { as } = row.data.target;
        const kept = yield* rowsOf(
          TargetSchema,
          read(
            composed(
              'SELECT series, target, target_count, target_at FROM prediction_rows WHERE playbook_key = ',
              each([row.playbookKey]),
              ' AND data_sha256 = ',
              each([row.dataSha256]),
              ' AND period_index >= ',
              each([first]),
              ' AND period_index <= ',
              each([last]),
            ),
          ),
        );
        const truths = new Map<string, number>();
        for (const { series, target, target_count: count, target_at: at } of kept) {
          const cell = cellOf({ value: target, count, at }, as);
          if (cell !== null) {
            truths.set(series, (truths.get(series) ?? 0) + cell);
          }
        }
        return { truths, absentIsZero: as === 'count' || as === 'sum' };
      }),
    )
    .pipe(
      Effect.catchTag('dataset_files_refused', () =>
        Effect.succeed({ truths: new Map<string, number>(), absentIsZero: false }),
      ),
      Effect.catchTag('database_failed', Effect.die),
    );
}
