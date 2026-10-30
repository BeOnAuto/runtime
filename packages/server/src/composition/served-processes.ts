import { documentsReadIn, type DocumentReading } from '@on.auto/documents';
import { processPool } from '@on.auto/workflow-engine/dsl';

import type { DocumentSettings } from '../function-settings/document-settings.ts';
import type { ServedClosing } from '../server-options/server-options.ts';

const mebibyte = 1_048_576;

export interface ServedProcesses {
  readonly documents: DocumentReading;
  readonly withDocumentsClosed: ServedClosing;
}

export function processesServedBy({ documents }: { readonly documents: DocumentSettings }): ServedProcesses {
  const { processes, processMemoryMebibytes, path } = documents;
  const documentPool = processPool({ processes, longJobs: 1, memoryBytes: processMemoryMebibytes * mebibyte, path });
  return {
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
