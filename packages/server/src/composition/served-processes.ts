import { documentsReadIn, type DocumentReading } from '@on.auto/documents';
import { processPool } from '@on.auto/workflow-engine/dsl';

import type { DocumentSettings } from '../function-settings/document-settings.ts';
import type { ServedClosing } from '../server-options/server-options.ts';

const mebibyte = 1_048_576;

export interface ServedProcesses {
  readonly documents: DocumentReading;
  readonly withDocumentsClosed: ServedClosing;
}

/** The processes the server reads documents in, or the reading it was given, which starts and closes nothing. */
export function processesServedBy(
  { documents }: { readonly documents: DocumentSettings },
  given?: DocumentReading,
): ServedProcesses {
  if (given !== undefined) {
    return { documents: given, withDocumentsClosed: (served) => served };
  }
  const { processes, processMemoryMebibytes, path } = documents;
  const documentPool = processPool({ processes, longJobs: 1, memoryBytes: processMemoryMebibytes * mebibyte, path });
  return {
    documents: documentsReadIn(documentPool),
    withDocumentsClosed: (served) => ({
      ...served,
      stopWork: async () => {
        await served.stopWork();
        await documentPool.close();
      },
    }),
  };
}
