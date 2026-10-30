import type { PlaybookAddress, RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { writtenDatasetFiles } from '../files/dataset-files.ts';
import type { DatasetFiles, DatasetFilesRefused } from '../files/files-refusals.ts';

export interface ShadowRows {
  readonly files: DatasetFiles;
  readonly path: string;
}

export function shadowRowsOf(
  ports: PredictionPorts,
  playbook: PlaybookAddress,
  document: PredictionFunctionDefinitionDocument,
  closesAt: number,
): Effect.Effect<ShadowRows, DatasetFilesRefused> {
  const paths = new Map<string, string>();
  const content: Pick<RecordedContent, 'put'> = {
    put: (_playbook, { stream, mediaType }) =>
      Effect.map(ports.caches.rows.received(stream), ({ sha256, bytes, path }) => {
        paths.set(sha256, path);
        return { sha256, bytes, mediaType };
      }),
  };
  return Effect.map(
    writtenDatasetFiles({ database: ports.database, content, playbook, document, now: closesAt }),
    (files) => ({ files, path: String(paths.get(files.scoring.sha256)) }),
  );
}
