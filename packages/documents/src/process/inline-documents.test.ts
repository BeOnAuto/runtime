import { inlinePool, type InlinePool, type ProcessHandlers } from '@on.auto/workflow-engine/dsl';
import { afterEach, describe, expect, it } from 'vitest';

import { documentBounds, documentTooLarge } from '../reading/document-bounds.ts';
import { refusedUnlessOutOfMemory, type DocumentText } from '../reading/document-text.ts';
import { pdfOfPages, wordDocumentOf } from '../testing/written-documents.ts';
import { documentJobKind, documentJobs } from './document-jobs.ts';
import { documentsReadIn } from './pooled-documents.ts';

const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const encoded = new TextEncoder();

const pools: InlinePool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) {
    pool.close();
  }
});

function readInAPoolOfItsOwn(handlers: ProcessHandlers = documentJobs()) {
  const pool = inlinePool({ jobs: 2, longJobs: 1, handlers });
  pools.push(pool);
  return documentsReadIn(pool);
}

function saidBy(document: DocumentText): string {
  return document.read ? document.text : document.because;
}

function pdfOf(pages: readonly (readonly string[])[]) {
  return { bytes: pdfOfPages(pages), mediaType: 'application/pdf', name: undefined };
}

const unbounded = { deadlineMs: 30_000, signal: undefined, textBytes: 1000 };

describe('a document read by the jobs of the reader in a pool a host serves in its own isolate', () => {
  it('answers the text of a PDF, of a Word document named for its type and of a text file, as a process does', async () => {
    const read = readInAPoolOfItsOwn();

    const texts = await Promise.all([
      read(pdfOf([['Supplier terms', 'Net 30']]), unbounded),
      read({ bytes: wordDocumentOf(['Net 30']), mediaType: 'application/octet-stream', name: 'Terms.docx' }, unbounded),
      read(
        { bytes: encoded.encode('Returns are taken within 14 days.'), mediaType: 'text/plain', name: 'a' },
        unbounded,
      ),
    ]);

    expect(texts).toEqual([
      { read: true, text: 'Supplier terms\nNet 30', mediaType: 'application/pdf' },
      { read: true, text: 'Net 30', mediaType: wordType },
      { read: true, text: 'Returns are taken within 14 days.', mediaType: 'text/plain' },
    ]);
  });

  it('answers an empty text as no text, and a PDF that holds none in words', async () => {
    const read = readInAPoolOfItsOwn();

    const texts = await Promise.all([
      read({ bytes: new Uint8Array(0), mediaType: 'text/plain', name: undefined }, unbounded),
      read(pdfOf([[]]), unbounded),
    ]);

    expect(texts).toEqual([
      { read: true, text: '', mediaType: 'text/plain' },
      {
        read: false,
        because: 'It holds no text, as a PDF of scanned pages holds none: the runtime reads no text in an image',
        mediaType: 'application/pdf',
      },
    ]);
  });
});

describe('a document the jobs of the reader bound in a pool a host serves in its own isolate', () => {
  it('refuses in words a document past the bytes and a PDF past the pages the runtime reads', async () => {
    const read = readInAPoolOfItsOwn();
    const tooLong = Array.from({ length: documentBounds.pdfPages + 1 }, (_, index) => [`Page ${index}`]);

    const texts = await Promise.all([
      read({ bytes: new Uint8Array(documentBounds.bytes + 1), mediaType: 'text/plain', name: undefined }, unbounded),
      read(pdfOf(tooLong), unbounded),
    ]);

    expect(texts.map((each) => saidBy(each))).toEqual([
      documentTooLarge,
      'It has 501 pages, more than the 500 the runtime reads of a PDF',
    ]);
  });

  it('answers at most the bytes of text it is bounded by, cut in the job', async () => {
    const read = readInAPoolOfItsOwn();
    const long = { bytes: encoded.encode('x'.repeat(400)), mediaType: 'text/plain', name: undefined };

    const text = saidBy(await read(long, { ...unbounded, textBytes: 150 }));

    expect({ bytes: encoded.encode(text).byteLength <= 150, note: text.slice(text.indexOf('\n')) }).toEqual({
      bytes: true,
      note: `\n[The text was cut to ${text.indexOf('\n')} of its 400 bytes, the most the runtime answers of a document here.]`,
    });
  });
});

describe('a document whose reading the pool of a host ends', () => {
  it('answers the words of memory where a reader meets an allocation that fails, and of time at the deadline', async () => {
    const outOfMemory = readInAPoolOfItsOwn({
      [documentJobKind]: () =>
        refusedUnlessOutOfMemory(
          new RangeError('Array buffer allocation failed'),
          'It is not a PDF the runtime can read',
        ),
    });
    const outOfTime = readInAPoolOfItsOwn({ [documentJobKind]: () => Promise.withResolvers<null>().promise });

    const texts = await Promise.all([
      outOfMemory(pdfOf([['Net 30']]), unbounded),
      outOfTime(pdfOf([['Net 30']]), { ...unbounded, deadlineMs: 200 }),
    ]);

    expect(texts).toEqual(
      [
        'It took more memory to read than a process that reads a document may take, so its reading was stopped',
        'It took longer to read than the 0.2 s the call had left, so its reading was stopped',
      ].map((because) => ({ read: false, because, mediaType: 'application/pdf' })),
    );
  });
});
