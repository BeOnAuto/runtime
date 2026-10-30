import type { ContentKept, PlaybookAddress, RecordedContent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { cellText, fieldOf, recordOf } from '../files/csv-text.ts';
import type { DatasetFiles } from '../files/files-refusals.ts';
import { seriesRowsOfStream, type SeriesRows } from '../files/series-rows.ts';
import { periodForm, periodOfForm } from '../periods/grains.ts';
import { featureNamesOf } from '../scoring/scoring-inputs.ts';

interface Span {
  readonly first: number;
  readonly last: number;
}

function cellsAt(rows: SeriesRows, at: number, width: number): readonly string[] {
  const value = Number(rows.values[at]);
  const features = Array.from({ length: width }, (_, column) => Number(rows.features[at * width + column]));
  return [value, ...features].map((cell) => cellText(Number.isNaN(cell) ? null : cell));
}

function lastPeriodOf(document: PredictionFunctionDefinitionDocument, all: readonly SeriesRows[]): number {
  const grain = document.predicts.period;
  return all.reduce(
    (latest, { periods }) =>
      periods.reduce((later, form) => Math.max(later, Number(periodOfForm(grain, form))), latest),
    Number.NEGATIVE_INFINITY,
  );
}

function seriesText(
  document: PredictionFunctionDefinitionDocument,
  rows: SeriesRows,
  span: Span,
  width: number,
): string {
  const grain = document.predicts.period;
  const byPeriod = new Map(rows.periods.map((form, at) => [periodOfForm(grain, form), at]));
  const records: string[] = [];
  for (let period = span.first; period <= span.last; period += 1) {
    const at = byPeriod.get(period);
    const cells = at === undefined ? Array.from({ length: width + 1 }, () => '') : cellsAt(rows, at, width);
    records.push(recordOf([fieldOf(rows.series), periodForm(grain, period), ...cells]));
  }
  return records.join('');
}

function observedIn(document: PredictionFunctionDefinitionDocument, rows: SeriesRows, span: Span): number {
  const grain = document.predicts.period;
  return rows.periods.filter((form, at) => {
    const period = Number(periodOfForm(grain, form));
    return period >= span.first && period <= span.last && !Number.isNaN(Number(rows.values[at]));
  }).length;
}

function kept(
  content: Pick<RecordedContent, 'put'>,
  playbook: PlaybookAddress,
  text: string,
): Effect.Effect<ContentKept> {
  return Effect.orDie(content.put(playbook, { stream: new Blob([text]).stream(), mediaType: 'text/csv' }));
}

export function uploadedDatasetFiles(
  content: Pick<RecordedContent, 'put' | 'get'>,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  dataset: string,
): Effect.Effect<DatasetFiles> {
  return Effect.gen(function* () {
    const upload = Option.getOrThrow(Option.fromNullishOr(yield* content.get(playbook, dataset)));
    const header = ['series', 'period', document.predicts.target, ...featureNamesOf(document)];
    const width = header.length - 3;
    const all = yield* Effect.promise(() => seriesRowsOfStream(upload.stream, { features: width }));
    const grain = document.predicts.period;
    const last = lastPeriodOf(document, all);
    const { window } = document.data;
    const { holdout } = document.evaluation;
    const scoringSpan = { first: last - window + 1, last };
    const trainingSpan = { ...scoringSpan, last: last - holdout };
    const series = all.filter((rows) => observedIn(document, rows, scoringSpan) >= holdout + 1);
    const headerText = recordOf(header.map((name) => fieldOf(name)));
    const scoring = yield* kept(
      content,
      playbook,
      headerText + series.map((rows) => seriesText(document, rows, scoringSpan, width)).join(''),
    );
    const training = yield* kept(
      content,
      playbook,
      headerText + series.map((rows) => seriesText(document, rows, trainingSpan, width)).join(''),
    );
    return {
      dataSha256: document.dataSha256,
      training: { sha256: training.sha256, bytes: training.bytes },
      scoring: { sha256: scoring.sha256, bytes: scoring.bytes },
      rows: series.length * window,
      series: series.length,
      seriesLeftOut: all.length - series.length,
      firstPeriod: periodForm(grain, scoringSpan.first),
      lastPeriod: periodForm(grain, last),
      window,
      holdout,
      checkpoint: null,
    };
  });
}
