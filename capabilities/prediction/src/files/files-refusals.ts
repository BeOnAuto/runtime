import type { RowPhase } from '@on.auto/workflow-host';
import { Data } from 'effect';

import { figure } from '../capability/figures.ts';
import { predictionBounds } from '../capability/prediction-bounds.ts';

interface WrittenFile {
  readonly sha256: string;
  readonly bytes: number;
}

export interface DatasetFiles {
  readonly dataSha256: string;
  readonly training: WrittenFile;
  readonly scoring: WrittenFile;
  readonly rows: number;
  readonly series: number;
  readonly seriesLeftOut: number;
  readonly firstPeriod: string;
  readonly lastPeriod: string;
  readonly window: number;
  readonly holdout: number;
  readonly checkpoint: string | null;
}

export interface WindowOfTheBuild {
  readonly first: number;
  readonly last: number;
  readonly trainingLast: number;
}

export type FilesRefusal =
  | { readonly kind: 'uploaded' }
  | { readonly kind: 'not_ready'; readonly phase: RowPhase | 'missing' }
  | { readonly kind: 'too_large'; readonly rows?: number; readonly series?: number; readonly bytes?: number };

export class DatasetFilesRefused extends Data.TaggedError('dataset_files_refused')<{
  readonly refusal: FilesRefusal;
  readonly detail: string;
}> {}

const { mostDatasetRows, mostDatasetSeries, mostDatasetBytes } = predictionBounds;

function tooLargeWords({
  rows,
  series,
  bytes,
}: Omit<Extract<FilesRefusal, { readonly kind: 'too_large' }>, 'kind'>): string {
  if (bytes !== undefined) {
    return `The rows take more than the ${figure(mostDatasetBytes)} bytes a build takes as CSV; narrow the window, the series or the features`;
  }
  return `The dataset holds ${figure(Number(rows))} rows over ${figure(Number(series))} series and a build takes ${figure(mostDatasetRows)} rows over at most ${figure(mostDatasetSeries)} series; narrow the window or the series`;
}

export const filesRefusedAs = {
  uploaded: () =>
    new DatasetFilesRefused({
      refusal: { kind: 'uploaded' },
      detail: 'The function names an uploaded dataset, which a build reads as it was uploaded',
    }),
  notReady: (phase: RowPhase | 'missing') =>
    new DatasetFilesRefused({
      refusal: { kind: 'not_ready', phase },
      detail:
        phase === 'stalled'
          ? 'The dataset stopped at an event its data test could not get through, which get_definition names; a data part that changes starts a dataset of its own'
          : "The dataset is still being built from the playbook's history; ask again once get_definition shows it live",
    }),
  tooLarge: (figures: { readonly rows?: number; readonly series?: number; readonly bytes?: number }) =>
    new DatasetFilesRefused({ refusal: { kind: 'too_large', ...figures }, detail: tooLargeWords(figures) }),
};
