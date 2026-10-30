import { cursorOfParts, InvalidInput, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { notReadyAs } from '../build/build-files.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { cellOf } from '../dataset/row-measures.ts';
import {
  isProjected,
  type PredictionFunctionDefinitionDocument,
  type ProjectedData,
} from '../document/prediction-document.ts';
import { datasetRead, windowOf } from '../files/build-reads.ts';
import type { DatasetFilesRefused } from '../files/files-refusals.ts';
import { periodsOfSeries } from '../files/window-reads.ts';

export interface SeriesWindow {
  readonly y: Readonly<Float64Array>;
  readonly x: Readonly<Float32Array> | null;
  readonly origin: number;
  readonly checkpoint: string | null;
}

export interface Asking {
  readonly playbook: PlaybookAddress;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly series: string;
  readonly now: number;
}

type WindowRefused = InvalidInput | Unavailable;

function unknownSeries(series: string): InvalidInput {
  const detail = `The dataset holds no series ${JSON.stringify(series)} in its window`;
  return new InvalidInput({ detail, issues: [{ pointer: '/series', detail }] });
}

function projectedWindow(ports: PredictionPorts, asking: Asking, data: ProjectedData) {
  const { document, playbook, now } = asking;
  const request = { database: ports.database, content: ports.ledger.content, playbook, document, now };
  return ports.database
    .readConsistently((read) =>
      Effect.gen(function* () {
        const row = yield* datasetRead(read, request);
        const span = windowOf(request);
        const kept = yield* periodsOfSeries(read, row, asking.series, span);
        if (kept.length === 0) {
          return yield* Effect.fail(unknownSeries(asking.series));
        }
        const byPeriod = new Map(kept.map((period) => [period.period, period]));
        const periods = Array.from({ length: span.last - span.first + 1 }, (_, at) => byPeriod.get(span.first + at));
        const width = data.features.length;
        return {
          y: Float64Array.from(periods, (period) => cellOf(period?.target, data.target.as) ?? Number.NaN),
          x:
            width === 0
              ? null
              : Float32Array.from(
                  periods.flatMap((period) =>
                    data.features.map(({ as }, at) => cellOf(period?.features[at], as) ?? Number.NaN),
                  ),
                ),
          origin: span.last,
          checkpoint: cursorOfParts([row.playbookKey, ...Option.getOrThrow(Option.fromNullishOr(row.checkpoint))]),
        };
      }),
    )
    .pipe(
      Effect.catchTags({
        dataset_files_refused: (refused: Pick<DatasetFilesRefused, 'refusal' | 'detail'>) =>
          Effect.fail<WindowRefused>(notReadyAs(refused)),
        database_failed: Effect.die,
      }),
    );
}

const busy = new Unavailable({ detail: 'Every model process is busy; try again shortly', kind: 'model_process_busy' });

function uploadedWindow(
  ports: PredictionPorts,
  { playbook, document, series }: Asking,
  sha256: string,
): Effect.Effect<SeriesWindow, WindowRefused> {
  return Effect.gen(function* () {
    const kept = yield* ports.caches.rows.pathOf(sha256, () => ports.ledger.content.get(playbook, sha256));
    const outcome = yield* ports.models.window(
      { sha256, path: Option.getOrThrow(Option.fromNullishOr(kept)) },
      {
        series,
        features: document.data.features.length,
        grain: document.predicts.period,
        window: document.data.window,
      },
    );
    if (outcome.ended === 'busy') {
      return yield* Effect.fail(busy);
    }
    if (outcome.ended !== 'answered') {
      return yield* Effect.fail(
        new Unavailable({ detail: 'The model process ended before it read the dataset', kind: 'model_process_failed' }),
      );
    }
    const { answer } = outcome;
    return 'unknown' in answer
      ? yield* Effect.fail(unknownSeries(series))
      : { y: answer.y, x: answer.x, origin: answer.origin, checkpoint: null };
  });
}

export function seriesWindow(ports: PredictionPorts, asking: Asking): Effect.Effect<SeriesWindow, WindowRefused> {
  const { data } = asking.document;
  if (isProjected(data)) {
    return projectedWindow(ports, asking, data);
  }
  return uploadedWindow(ports, asking, data.dataset);
}
