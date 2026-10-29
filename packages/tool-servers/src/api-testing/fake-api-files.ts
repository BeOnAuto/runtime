import { documentBounds } from '@on.auto/documents';
import { pdfOfNestedDrawings, pdfOfPages, wordDocumentOf, wordDocumentRepeating } from '@on.auto/documents/testing';

export const pixel = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const fakeFileTexts = {
  pdf: ['Supplier terms', 'Payment is due within 30 days of the invoice.'],
  word: ['Supplier terms', 'Goods arrive within 10 days of the order.'],
  text: 'Supplier terms\nReturns are taken within 14 days.\n',
} as const;

function largeFile(): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1_048_576);
  let sent = 0;
  return new ReadableStream({
    pull: (controller) => {
      if (sent > documentBounds.bytes) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const unpackedParagraphs = 1_800_000;

const files: ReadonlyMap<string, () => Response> = new Map([
  [
    'terms.pdf',
    () =>
      new Response(pdfOfPages([fakeFileTexts.pdf]), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="Supplier terms.pdf"',
        },
      }),
  ],
  [
    'terms.docx',
    () =>
      new Response(wordDocumentOf(fakeFileTexts.word), {
        headers: {
          'content-type': wordType,
          'content-disposition': "attachment; filename*=UTF-8''Supplier%20terms.docx",
        },
      }),
  ],
  ['terms.txt', () => new Response(fakeFileTexts.text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })],
  ['photo.png', () => new Response(pixel, { headers: { 'content-type': 'image/png' } })],
  ['large.pdf', () => new Response(largeFile(), { headers: { 'content-type': 'application/pdf' } })],
  [
    'nested.pdf',
    () =>
      new Response(pdfOfNestedDrawings({ fanOut: 10, depth: 7 }), { headers: { 'content-type': 'application/pdf' } }),
  ],
  [
    'unpacking.docx',
    () =>
      new Response(wordDocumentRepeating('a', unpackedParagraphs), {
        headers: { 'content-type': wordType },
      }),
  ],
]);

export function fileNamed(name: string): Response {
  return files.get(name)?.() ?? new Response(`No file named ${name}`, { status: 404 });
}
