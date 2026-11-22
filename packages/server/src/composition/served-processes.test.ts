import { documentsReadInProcess } from '@on.auto/documents/testing';
import { describe, expect, it } from 'vitest';

import { servedBy } from '../server-options/server-options.ts';
import { processesServedBy } from './served-processes.ts';

const settings = { documents: { processes: 1, processMemoryMebibytes: 768, path: undefined } };

describe('the processes a server reads documents in', () => {
  it('are none when the server is given a reading: the documents are read by it, and its stop closes no pool', () => {
    const served = servedBy([]);

    const processes = processesServedBy(settings, documentsReadInProcess);

    expect(processes.documents).toBe(documentsReadInProcess);
    expect(processes.withDocumentsClosed(served)).toBe(served);
  });
});
