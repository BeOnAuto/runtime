import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { pdfOfPages, wordDocumentOf } from '../testing/written-documents.ts';
import { documentBounds, documentTooLarge } from './document-bounds.ts';
import type { DocumentText } from './document-text.ts';
import { textOfDocument } from './text-of-document.ts';

const encoded = new TextEncoder();

const byteOrderMark = String.fromCodePoint(0xfe_ff);

const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const unreadOctets =
  'The runtime does not read application/octet-stream as text; it reads text, PDF and Word documents';

function textOf(mediaType: string, text: string, name?: string): Promise<DocumentText> {
  return textOfDocument({ bytes: encoded.encode(text), mediaType, name });
}

function bytesOf(mediaType: string, bytes: Readonly<Uint8Array>): Promise<DocumentText> {
  return textOfDocument({ bytes, mediaType, name: undefined });
}

function saidBy(read: DocumentText): string {
  return read.read ? read.text : read.because;
}

async function withoutFetching<A>(read: () => Promise<A>): Promise<{ readonly read: A; readonly fetched: number }> {
  const before = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => {
    fetched += 1;
    return Promise.reject(new Error('A reader fetched'));
  };
  try {
    return { read: await read(), fetched };
  } finally {
    globalThis.fetch = before;
  }
}

describe('the text of a text document', () => {
  it('is its bytes as UTF-8, the byte order mark dropped, for every text type and the textual application types', async () => {
    const texts = await Promise.all([
      textOf('text/plain; charset=utf-8', `${byteOrderMark}Supplier terms\nNet 30.`),
      textOf('Text/CSV', 'supplier,days\nacme,30\n'),
      textOf('application/json', '{"days":30}'),
      textOf('application/ld+json', '{"@type":"Offer"}'),
      textOf('application/atom+xml', '<feed/>'),
      textOf('application/x-yaml', 'days: 30'),
      textOf('application/vnd.terms+yaml', 'days: 30'),
    ]);

    expect(texts).toEqual([
      { read: true, text: 'Supplier terms\nNet 30.', mediaType: 'text/plain' },
      { read: true, text: 'supplier,days\nacme,30\n', mediaType: 'text/csv' },
      { read: true, text: '{"days":30}', mediaType: 'application/json' },
      { read: true, text: '{"@type":"Offer"}', mediaType: 'application/ld+json' },
      { read: true, text: '<feed/>', mediaType: 'application/atom+xml' },
      { read: true, text: 'days: 30', mediaType: 'application/x-yaml' },
      { read: true, text: 'days: 30', mediaType: 'application/vnd.terms+yaml' },
    ]);
  });

  it('reads every other textual application type as text', async () => {
    const types = ['application/xml', 'application/yaml', 'application/csv', 'application/markdown', 'text/markdown'];

    const texts = await Promise.all(types.map((mediaType) => textOf(mediaType, 'a')));

    expect(texts).toEqual(types.map((mediaType) => ({ read: true, text: 'a', mediaType })));
  });
});

describe('the encoding of a text document', () => {
  it('is that of its byte order mark, UTF-16 among them, or else its charset, or else UTF-8', async () => {
    const texts = await Promise.all([
      bytesOf('text/plain', Uint8Array.from([0xff, 0xfe, ...Buffer.from('Net 30', 'utf16le')])),
      bytesOf('text/plain; charset=iso-8859-1', Uint8Array.from([0xfe, 0xff, 0, 0x4e, 0, 0x65, 0, 0x74])),
      bytesOf('text/plain; charset=UTF-16LE', Buffer.from('Net 30', 'utf16le')),
      bytesOf('text/csv; charset="iso-8859-1"', Uint8Array.of(0x63, 0x61, 0x66, 0xe9)),
      bytesOf('text/plain; charset=x-unheard-of', encoded.encode('café')),
      bytesOf('text/plain', Uint8Array.of(0x4e, 0xff, 0x33)),
    ]);

    expect(texts.map((each) => saidBy(each))).toEqual([
      'Net 30',
      'Net',
      'Net 30',
      'café',
      'café',
      `N${String.fromCodePoint(0xff_fd)}3`,
    ]);
  });
});

describe('the type of a document', () => {
  it('whose type says nothing is the type the extension of its name names, where it names a type the runtime reads', async () => {
    const texts = await Promise.all([
      textOf('application/octet-stream', 'days: 30', 'terms.YML'),
      textOf('application/octet-stream', 'days: 30', 'terms'),
      textOf('application/octet-stream', 'days: 30', 'terms.bin'),
      textOf('application/octet-stream', 'days: 30'),
    ]);

    expect(texts).toEqual([
      { read: true, text: 'days: 30', mediaType: 'application/yaml' },
      ...Array.from({ length: 3 }, () => ({
        read: false,
        because: unreadOctets,
        mediaType: 'application/octet-stream',
      })),
    ]);
  });

  it('that is not written as a type and its subtype is read as one that says nothing', async () => {
    const texts = await Promise.all([
      textOf(`text/plain${String.fromCodePoint(0x85)}`, 'a'),
      textOf('nonsense', 'a'),
      textOf('', 'a'),
    ]);

    expect(texts).toEqual(
      Array.from({ length: 3 }, () => ({ read: false, because: unreadOctets, mediaType: 'application/octet-stream' })),
    );
  });
});

describe('the text of a PDF', () => {
  it('is the text of each of its pages, page by page, fetching nothing', async () => {
    const bytes = pdfOfPages([
      ['Supplier terms', 'Payment is due (net) within 30 days.'],
      [],
      ['Delivery', 'Goods arrive within 10 days.'],
    ]);

    const { read, fetched } = await withoutFetching(() =>
      textOfDocument({ bytes, mediaType: 'application/pdf', name: 'Supplier terms.pdf' }),
    );

    expect({ read, fetched }).toEqual({
      read: {
        read: true,
        text: 'Supplier terms\nPayment is due (net) within 30 days.\n\nDelivery\nGoods arrive within 10 days.',
        mediaType: 'application/pdf',
      },
      fetched: 0,
    });
  });

  it('is read where the name says PDF and the type says nothing, the type read being PDF', async () => {
    expect(
      await textOfDocument({ bytes: pdfOfPages([['Net 30']]), mediaType: 'application/octet-stream', name: 'a.pdf' }),
    ).toEqual({ read: true, text: 'Net 30', mediaType: 'application/pdf' });
  });

  it('is refused in words past the pages the runtime reads, where it holds no text, and where it is broken', async () => {
    const tooLong = pdfOfPages(Array.from({ length: documentBounds.pdfPages + 1 }, (_, index) => [`Page ${index}`]));
    const read = await Promise.all(
      [tooLong, pdfOfPages([[]]), encoded.encode('%PDF-1.7 and nothing more')].map((bytes: Readonly<Uint8Array>) =>
        bytesOf('application/pdf', bytes),
      ),
    );

    expect(read.map((each) => saidBy(each))).toEqual([
      'It has 501 pages, more than the 500 the runtime reads of a PDF',
      'It holds no text, as a PDF of scanned pages holds none: the runtime reads no text in an image',
      'It is not a PDF the runtime can read: InvalidPDFException: Invalid PDF structure.',
    ]);
  });
});

describe('the text of a Word document', () => {
  it('is the text of its paragraphs, fetching nothing', async () => {
    const { read, fetched } = await withoutFetching(() =>
      textOfDocument({
        bytes: wordDocumentOf(['Supplier terms', 'Payment & delivery <within 30 days>']),
        mediaType: wordType,
        name: 'Supplier terms.docx',
      }),
    );

    expect({ read, fetched }).toEqual({
      read: { read: true, text: 'Supplier terms\n\nPayment & delivery <within 30 days>', mediaType: wordType },
      fetched: 0,
    });
  });

  it('is refused in words where it is broken, as are bytes named for Word whose type says nothing', async () => {
    const notAZip: unknown = expect.stringMatching(
      /^It is not a Word document the runtime can read: Error: Can't find end of central directory/u,
    );

    expect(await textOf('application/octet-stream', 'not a zip', 'terms.docx')).toEqual({
      read: false,
      because: notAZip,
      mediaType: wordType,
    });
  });
});

describe('a document the runtime does not read', () => {
  it('of another type says its type and what the runtime reads', async () => {
    expect(await textOf('image/png', 'png')).toEqual({
      read: false,
      because: 'The runtime does not read image/png as text; it reads text, PDF and Word documents',
      mediaType: 'image/png',
    });
  });

  it('larger than the bytes the runtime reads of a document is refused in words, whatever its type', async () => {
    const bytes = new Uint8Array(documentBounds.bytes + 1);

    expect(await bytesOf('text/plain', bytes)).toEqual({
      read: false,
      because: documentTooLarge,
      mediaType: 'text/plain',
    });
    expect(documentTooLarge).toBe('It takes more than the 20 MiB the runtime reads of a document');
  });
});
