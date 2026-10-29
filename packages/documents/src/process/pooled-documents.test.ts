import { processPool, type ProcessOutcome, type ProcessPool } from '@on.auto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import type { DocumentText } from '../reading/document-text.ts';
import { documentsReadInProcess } from '../testing/index.ts';
import { pdfOfNestedDrawings, pdfOfPages, wordDocumentOf } from '../testing/written-documents.ts';
import { documentJobs, documentJobKind } from './document-jobs.ts';
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

function saidBy(document: DocumentText): string {
  return document.read ? document.text : document.because;
}

function answering(outcome: ProcessOutcome): DocumentProcesses {
  return { run: () => Promise.resolve(outcome) };
}

function payloadNamed(name: string | null) {
  return { bytes: pdfOfPages([['Net 30']]), mediaType: 'application/pdf', name, textBytes: 1000 };
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

  it('answers at most the bytes of text it is bounded by, cut in the process', async () => {
    const read = documentsReadIn(poolForTheTest());
    const long = { bytes: new TextEncoder().encode('x'.repeat(400)), mediaType: 'text/plain', name: undefined };

    const cut = await read(long, { ...unbounded, textBytes: 150 });
    const text = saidBy(cut);

    expect({ bytes: new TextEncoder().encode(text).byteLength <= 150, note: text.slice(text.indexOf('\n')) }).toEqual({
      bytes: true,
      note: `\n[The text was cut to ${text.indexOf('\n')} of its 400 bytes, the most the runtime answers of a document here.]`,
    });
  });
});

describe('a document read in a process of the pool past its time', () => {
  it('stops a PDF that draws its drawings within one another at the time the call has left, and reads the next', async () => {
    const read = documentsReadIn(poolForTheTest());
    const nested = nestedPdf();
    const started = performance.now();

    const stopped = await read(nested, { ...unbounded, deadlineMs: 1500 });
    const took = performance.now() - started;
    const next = await read(termsPdf(), unbounded);

    expect(nested.bytes.byteLength).toBeLessThan(2500);
    expect(stopped).toEqual({
      read: false,
      because: 'It took longer to read than the 1.5 s the call had left, so its reading was stopped',
      mediaType: 'application/pdf',
    });
    expect(took).toBeLessThan(4000);
    expect(next).toMatchObject({ read: true, text: 'Supplier terms\nNet 30' });
  });

  it('words a reading the call stops at its own deadline as a reading out of time', async () => {
    const read = documentsReadIn(poolForTheTest());

    expect(await read(nestedPdf(), { ...unbounded, deadlineMs: 1000, signal: AbortSignal.timeout(500) })).toEqual({
      read: false,
      because: 'It took longer to read than the 1.0 s the call had left, so its reading was stopped',
      mediaType: 'application/pdf',
    });
  });

  it('ends a reading when the call ends for another reason', async () => {
    const read = documentsReadIn(poolForTheTest());
    const ending = new AbortController();
    const reading = read(nestedPdf(), { ...unbounded, signal: ending.signal });

    ending.abort();

    expect(await reading).toMatchObject({ read: false, because: 'The call ended before it was read' });
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

describe('the jobs of a process that reads documents', () => {
  it('read the document of their payload, named or not', async () => {
    const reads = documentJobs()[documentJobKind];

    expect(await Promise.all([reads?.(payloadNamed(null)), reads?.(payloadNamed('a.pdf'))])).toEqual([
      { read: true, text: 'Net 30', mediaType: 'application/pdf' },
      { read: true, text: 'Net 30', mediaType: 'application/pdf' },
    ]);
  });

  it('are read in the process of a test through the testing entry, which no composition takes', async () => {
    expect(await documentsReadInProcess(termsPdf(), unbounded)).toMatchObject({
      read: true,
      text: 'Supplier terms\nNet 30',
    });
  });
});
