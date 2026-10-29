import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { processPool, type ProcessPool } from '@on.auto/workflow-engine/dsl';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { pdfOfPages, wordDocumentOf, wordDocumentRepeating } from '../testing/written-documents.ts';
import { documentJobKind } from './document-jobs.ts';
import { documentsReadIn } from './pooled-documents.ts';

const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const outOfMemory =
  'It took more memory to read than a process that reads a document may take, so its reading was stopped';

const theLongestRead = 120_000;

const unbounded = { deadlineMs: 30_000, signal: undefined, textBytes: 1000 };

const pools: ProcessPool[] = [];

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

afterAll(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function poolForTheTest(): ProcessPool {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 768 * 1_048_576, path: process.env['PATH'] });
  pools.push(pool);
  return pool;
}

function termsPdf() {
  return { bytes: pdfOfPages([['Supplier terms', 'Net 30']]), mediaType: 'application/pdf', name: undefined };
}

function failingToAllocate(): () => URL {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-documents-'));
  directories.push(directory);
  const module = pathToFileURL(join(directory, 'failing-to-allocate.ts'));
  writeFileSync(
    module,
    [
      `import { serveProcessJobs } from '${import.meta.resolve('@on.auto/workflow-engine/process-loop')}';`,
      `import { refusedUnlessOutOfMemory } from '${new URL('../reading/document-text.ts', import.meta.url).href}';`,
      `serveProcessJobs({ ${documentJobKind}: () => refusedUnlessOutOfMemory(new RangeError('Array buffer allocation failed'), 'It is not a Word document the runtime can read') }, process);`,
    ].join('\n'),
  );
  return () => module;
}

describe('a document read in a process of the pool that would take more memory than it may', () => {
  it(
    'stops a Word document that unpacks to far more than it takes as out of memory, and reads the next',
    async () => {
      const read = documentsReadIn(poolForTheTest());
      const bomb = wordDocumentRepeating('a', 1_800_000);

      const stopped = await read(
        { bytes: bomb, mediaType: wordType, name: undefined },
        { ...unbounded, deadlineMs: theLongestRead },
      );
      const next = await read(termsPdf(), unbounded);

      expect(bomb.byteLength).toBeLessThan(250_000);
      expect(stopped).toEqual({ read: false, because: outOfMemory, mediaType: wordType });
      expect(next).toMatchObject({ read: true });
    },
    theLongestRead + 30_000,
  );

  it('is stopped as out of memory where a reader meets an allocation that fails, never refused as broken', async () => {
    const read = documentsReadIn(poolForTheTest(), failingToAllocate());

    expect(await read({ bytes: wordDocumentOf(['a']), mediaType: wordType, name: undefined }, unbounded)).toEqual({
      read: false,
      because: outOfMemory,
      mediaType: wordType,
    });
  });
});
