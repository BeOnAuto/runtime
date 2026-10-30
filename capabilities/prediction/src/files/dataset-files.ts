import { cursorOfParts } from '@on.auto/operations';
import type { DatabaseFailed, ReadStatement } from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { isProjected, type ProjectedData } from '../document/prediction-document.ts';
import { periodForm } from '../periods/grains.ts';
import { datasetRead, keptFile, windowOf, type FilesRequest } from './build-reads.ts';
import { byUtf8 } from './csv-text.ts';
import { filesRefusedAs, type DatasetFiles, type DatasetFilesRefused } from './files-refusals.ts';
import { observedSeriesOf, windowCountOf } from './window-reads.ts';

const { mostDatasetRows, mostDatasetSeries } = predictionBounds;

function writtenAtOneCheckpoint(
  read: ReadStatement,
  request: FilesRequest,
  data: ProjectedData,
): Effect.Effect<DatasetFiles, DatasetFilesRefused | DatabaseFailed> {
  const { content, playbook, document } = request;
  return Effect.gen(function* () {
    const row = yield* datasetRead(read, request);
    const window = windowOf(request);
    const { holdout } = document.evaluation;
    const leastObserved = holdout + 1;
    const count = yield* windowCountOf(read, row, window, leastObserved);
    const rows = count.observed * data.window;
    if (count.observed > mostDatasetSeries || rows > mostDatasetRows) {
      return yield* Effect.fail(filesRefusedAs.tooLarge({ rows, series: count.observed }));
    }
    const series = (yield* observedSeriesOf(read, row, window, leastObserved)).toSorted(byUtf8);
    const header = ['series', 'period', document.predicts.target, ...data.features.map(({ name }) => name)];
    const plan = { read, row, header, series, mostBytes: request.mostBytes ?? predictionBounds.mostDatasetBytes };
    const scoring = yield* keptFile(content, playbook, { ...plan, span: window });
    const training = yield* keptFile(content, playbook, {
      ...plan,
      span: { first: window.first, last: window.trainingLast },
    });
    return {
      dataSha256: document.dataSha256,
      training: { sha256: training.sha256, bytes: training.bytes },
      scoring: { sha256: scoring.sha256, bytes: scoring.bytes },
      rows,
      series: series.length,
      seriesLeftOut: count.seriesInWindow - series.length,
      firstPeriod: periodForm(document.predicts.period, window.first),
      lastPeriod: periodForm(document.predicts.period, window.last),
      window: data.window,
      holdout,
      checkpoint: cursorOfParts([row.playbookKey, ...Option.getOrThrow(Option.fromNullishOr(row.checkpoint))]),
    };
  });
}

export function writtenDatasetFiles(request: FilesRequest): Effect.Effect<DatasetFiles, DatasetFilesRefused> {
  const { data } = request.document;
  if (!isProjected(data)) {
    return Effect.fail(filesRefusedAs.uploaded());
  }
  return request.database
    .readConsistently((read) => writtenAtOneCheckpoint(read, request, data))
    .pipe(Effect.catchTag('database_failed', Effect.die));
}
