import { documentsReadIn, type DocumentReading } from '@on.auto/documents';
import { processPool, type ProcessPool } from '@on.auto/workflow-engine/dsl';

import type { DocumentSettings } from '../function-settings/document-settings.ts';
import type { PredictionSettings } from '../function-settings/prediction-settings.ts';
import type { ServedClosing } from '../server-options/server-options.ts';

const mebibyte = 1_048_576;

export interface ServedProcesses {
  readonly pool: ProcessPool;
  readonly documents: DocumentReading;
  readonly withDocumentsClosed: ServedClosing;
}

interface ProcessSettings {
  readonly prediction: PredictionSettings;
  readonly documents: DocumentSettings;
}

export function processesServedBy({ prediction, documents }: ProcessSettings): ServedProcesses {
  const { processes, processMemoryMebibytes, buildsAtOnce, path } = prediction;
  const memoryBytes = processMemoryMebibytes * mebibyte;
  const pool = processPool({ processes, longJobs: buildsAtOnce, memoryBytes, path });
  const documentPool = processPool({ processes: documents.processes, longJobs: 1, memoryBytes, path });
  return {
    pool,
    documents: documentsReadIn(documentPool),
    withDocumentsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await documentPool.close();
      },
    }),
  };
}
