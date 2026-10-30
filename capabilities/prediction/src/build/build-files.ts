import { Conflict, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { isProjected, type PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { Assembled } from '../facts/build-facts.ts';
import { writtenDatasetFiles } from '../files/dataset-files.ts';
import type { DatasetFiles, DatasetFilesRefused } from '../files/files-refusals.ts';
import { candidatesJudgeable } from './perfect-baselines.ts';
import { uploadedDatasetFiles } from './uploaded-files.ts';

export function notReadyAs({ refusal, detail }: Pick<DatasetFilesRefused, 'refusal' | 'detail'>): Unavailable {
  const stalled = refusal.kind === 'not_ready' && refusal.phase === 'stalled';
  return new Unavailable({ detail, kind: 'dataset_not_ready', ...(stalled ? { because: 'stalled' } : {}) });
}

function refusedAs(refused: Pick<DatasetFilesRefused, 'refusal' | 'detail'>): Conflict | Unavailable {
  return refused.refusal.kind === 'too_large'
    ? new Conflict({ detail: refused.detail, kind: 'dataset_too_large' })
    : notReadyAs(refused);
}

export function assembledOf(files: DatasetFiles): Assembled {
  return {
    data_sha256: files.dataSha256,
    training_sha256: files.training.sha256,
    training_bytes: files.training.bytes,
    scoring_sha256: files.scoring.sha256,
    scoring_bytes: files.scoring.bytes,
    rows: files.rows,
    series: files.series,
    series_left_out: files.seriesLeftOut,
    first_period: files.firstPeriod,
    last_period: files.lastPeriod,
    window: files.window,
    holdout: files.holdout,
    checkpoint: files.checkpoint,
  };
}

export function buildFilesOf(
  ports: PredictionPorts,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  now: number,
): Effect.Effect<DatasetFiles, Conflict | Unavailable> {
  const { data } = document;
  const { ledger, database } = ports;
  const written = isProjected(data)
    ? writtenDatasetFiles({ database, content: ledger.content, playbook, document, now })
    : uploadedDatasetFiles(ledger.content, playbook, document, data.dataset);
  return written.pipe(
    Effect.mapError(refusedAs),
    Effect.tap((files) => candidatesJudgeable(ports, playbook, document, assembledOf(files))),
  );
}
