import {
  cursorOfParts,
  InvalidInput,
  streamPrefixOfPlaybook,
  Unavailable,
  type PlaybookAddress,
} from '@on.auto/operations';
import {
  rowsOf,
  type DatabaseFailed,
  type HostDatabase,
  type ReadStatement,
  type RowPhase,
} from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

import { datasetRowOf, StoredDatasetSchema, type DatasetRow } from '../dataset/dataset-rows.ts';
import { datasetNamed } from '../dataset/dataset-statements.ts';
import { cellOf } from '../dataset/row-measures.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { periodOfMoment } from '../periods/moments.ts';
import { isHeldBefore, periodsOfSeries, type WindowSpan } from './window-reads.ts';

export interface SeriesWindow {
  readonly observed: readonly (number | null)[];
  readonly first: number;
  readonly origin: number;
  readonly checkpoint: string;
}

export interface Asking {
  readonly playbook: PlaybookAddress;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly series: string;
  readonly now: number;
}

export type WindowRefused = InvalidInput | Unavailable;

function notReady(phase: RowPhase | 'missing'): Unavailable {
  return phase === 'stalled'
    ? new Unavailable({
        detail:
          'The dataset stopped at an event its data test could not get through, which get_definition names; a data part that changes starts a dataset of its own',
        kind: 'dataset_not_ready',
        because: 'stalled',
      })
    : new Unavailable({
        detail:
          "The dataset is still being built from the playbook's history; ask again once get_definition shows it live",
        kind: 'dataset_not_ready',
      });
}

function unknownSeries(series: string): InvalidInput {
  const detail = `The dataset holds no series ${JSON.stringify(series)} in its window`;
  return new InvalidInput({ detail, issues: [{ pointer: '/series', detail }] });
}

function liveDatasetOf(
  read: ReadStatement,
  { playbook, document }: Asking,
): Effect.Effect<DatasetRow, Unavailable | DatabaseFailed> {
  const named = datasetNamed(streamPrefixOfPlaybook(playbook), document.dataSha256);
  return rowsOf(StoredDatasetSchema, read(named)).pipe(
    Effect.flatMap(([stored]) => {
      const row = stored === undefined ? undefined : datasetRowOf(stored);
      return row?.phase === 'live' ? Effect.succeed(row) : Effect.fail(notReady(row?.phase ?? 'missing'));
    }),
  );
}

function spanOf({ document, now }: Asking): WindowSpan {
  const last = periodOfMoment(document.predicts.period, now) - 1;
  return { first: last - document.data.window + 1, last };
}

export function seriesWindow(
  database: Pick<HostDatabase, 'readConsistently'>,
  asking: Asking,
): Effect.Effect<SeriesWindow, WindowRefused> {
  const { as } = asking.document.data.target;
  return database
    .readConsistently((read) =>
      Effect.gen(function* () {
        const row = yield* liveDatasetOf(read, asking);
        const span = spanOf(asking);
        const kept = yield* periodsOfSeries(read, row, asking.series, span);
        const [firstKept] = kept;
        if (firstKept === undefined) {
          return yield* Effect.fail(unknownSeries(asking.series));
        }
        const heldBefore = yield* isHeldBefore(read, row, asking.series, span.first);
        const from = heldBefore ? span.first : firstKept.period;
        const byPeriod = new Map(kept.map((period) => [period.period, period]));
        return {
          observed: Array.from({ length: span.last - span.first + 1 }, (_, at) => {
            const period = span.first + at;
            return period < from ? null : cellOf(byPeriod.get(period)?.target, as);
          }),
          first: span.first,
          origin: span.last,
          checkpoint: cursorOfParts([row.playbookKey, ...Option.getOrThrow(Option.fromNullishOr(row.checkpoint))]),
        };
      }),
    )
    .pipe(Effect.catchTag('database_failed', Effect.die));
}
