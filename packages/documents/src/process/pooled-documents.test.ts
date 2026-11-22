import { processPool, type ProcessOutcome, type ProcessPool } from '@on.auto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import { documentsReadInProcess } from '../testing/index.ts';
import { pdfOfNestedDrawings, pdfOfPages, wordDocumentOf } from '../testing/written-documents.ts';
import { documentsReadIn, unreadDocuments, type DocumentProcesses } from './pooled-documents.ts';

const mebibyte = 1_048_576;

const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const outOfMemory =
  'It took more memory to read than a process that reads a document may take, so its reading was stopped';

const pools: ProcessPool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolForTheTest(): ProcessPool {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 768 * mebibyte, path: process.env['PATH'] });
  pools.push(pool);
  return pool;
}

function answering(outcome: ProcessOutcome): DocumentProcesses {
  return { run: () => Promise.resolve(outcome) };
}

interface ProcessRun {
  readonly deadlineMs: number;
  readonly ended: ProcessOutcome['ended'];
}

function recordedIn(pool: DocumentProcesses): {
  readonly processes: DocumentProcesses;
  readonly runs: readonly ProcessRun[];
} {
  const runs: ProcessRun[] = [];
  return {
    processes: {
      run: async (job, signal) => {
        const outcome = await pool.run(job, signal);
        runs.push({ deadlineMs: job.deadlineMs, ended: outcome.ended });
        return outcome;
      },
    },
    runs,
  };
}

function termsPdf() {
  return { bytes: pdfOfPages([['Supplier terms', 'Net 30']]), mediaType: 'application/pdf', name: undefined };
}

function nestedPdf() {
  return { bytes: pdfOfNestedDrawings({ fanOut: 10, depth: 7 }), mediaType: 'application/pdf', name: undefined };
}

const unbounded = { deadlineMs: 30_000, signal: undefined, textBytes: 1000 };

describe('a document read in a process of the pool', () => {
  it('answers the text a process reads, of a PDF and of a Word document named for its type', async () => {
    const read = documentsReadIn(poolForTheTest());

    const texts = await Promise.all([
      read(termsPdf(), unbounded),
      read({ bytes: wordDocumentOf(['Net 30']), mediaType: 'application/octet-stream', name: 'Terms.docx' }, unbounded),
    ]);

    expect(texts).toEqual([
      { read: true, text: 'Supplier terms\nNet 30', mediaType: 'application/pdf' },
      { read: true, text: 'Net 30', mediaType: wordType },
    ]);
  });
});

describe('a document whose reading the pool stops at the time the call has left', () => {
  it('hands the pool the time the call has left, and words what it stopped as out of time', async () => {
    const { processes, runs } = recordedIn(answering({ ended: 'timed_out', milliseconds: 1500 }));

    const stopped = await documentsReadIn(processes)(nestedPdf(), { ...unbounded, deadlineMs: 1500 });

    expect(stopped).toEqual({
      read: false,
      because: 'It took longer to read than the 1.5 s the call had left, so its reading was stopped',
      mediaType: 'application/pdf',
    });
    expect(runs).toEqual([{ deadlineMs: 1500, ended: 'timed_out' }]);
  });

  it('words a reading the call stops at its own deadline as a reading out of time', async () => {
    const outOfTime = new AbortController();
    outOfTime.abort(new DOMException('The call ran out of time', 'TimeoutError'));
    const read = documentsReadIn(answering({ ended: 'cancelled', milliseconds: 1000 }));

    expect(await read(nestedPdf(), { ...unbounded, deadlineMs: 1000, signal: outOfTime.signal })).toEqual({
      read: false,
      because: 'It took longer to read than the 1.0 s the call had left, so its reading was stopped',
      mediaType: 'application/pdf',
    });
  });

  it('hands the pool the signal of the call, and words a reading it ended for another reason', async () => {
    const ending = new AbortController();
    const handed: (AbortSignal | undefined)[] = [];
    const read = documentsReadIn({
      run: (_job, signal) => {
        handed.push(signal);
        return Promise.resolve({ ended: 'cancelled', milliseconds: 1 });
      },
    });
    ending.abort();

    expect(await read(nestedPdf(), { ...unbounded, signal: ending.signal })).toMatchObject({
      read: false,
      because: 'The call ended before it was read',
    });
    expect(handed).toEqual([ending.signal]);
  });
});

describe('a document a process could not read', () => {
  it('answers in words what stopped it, whatever the pool answers', async () => {
    const outcomes: readonly ProcessOutcome[] = [
      { ended: 'out_of_memory', milliseconds: 1 },
      { ended: 'busy', milliseconds: 1 },
      { ended: 'closing', milliseconds: 1 },
      { ended: 'crashed', detail: 'The process ended by SIGSEGV before it answered', milliseconds: 1 },
      { ended: 'answered', answer: { pages: 3 }, milliseconds: 1 },
      { ended: 'timed_out', milliseconds: 1 },
      { ended: 'cancelled', milliseconds: 1 },
    ];

    const read = await Promise.all(
      outcomes.map((outcome) => documentsReadIn(answering(outcome))(termsPdf(), { ...unbounded, deadlineMs: -5 })),
    );

    expect(read).toEqual(
      [
        outOfMemory,
        'Every process that reads a document stayed busy for the time the call had left',
        'The server was closing, so it was not read',
        'The process that read it ended without an answer: The process ended by SIGSEGV before it answered',
        'The process that read it answered what is not the text of a document',
        'It took longer to read than the 0.0 s the call had left, so its reading was stopped',
        'The call ended before it was read',
      ].map((because) => ({ read: false, because, mediaType: 'application/pdf' })),
    );
  });

  it('is never read where the runtime was composed with no process to read it in', async () => {
    expect(await unreadDocuments({ ...termsPdf(), mediaType: 'nonsense' }, unbounded)).toEqual({
      read: false,
      because:
        'The runtime reads no document here, since it was composed with no process to read one in, and it reads none in its own',
      mediaType: 'application/octet-stream',
    });
  });
});

describe('a document read in the process of a test', () => {
  it('are read in the process of a test through the testing entry, which no composition takes', async () => {
    expect(await documentsReadInProcess(termsPdf(), unbounded)).toMatchObject({
      read: true,
      text: 'Supplier terms\nNet 30',
    });
  });
});
