import { documentsReadInProcess, pdfOfPages, wordDocumentOf } from '@on.auto/documents/testing';
import { describe, expect, it } from 'vitest';

import { accessTo, answerOf, apiKey, called, closedAfter, fakeApi, keyed } from '../api-testing/api-calls.ts';
import { fakeFileTexts } from '../api-testing/fake-api-files.ts';
import { measured, toolBounds } from '../bounds/call-bounds.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import type { AnsweredFile } from './answer-bodies.ts';
import { settledOf } from './api-answers.ts';
import { DocumentTooLarge } from './document-too-large.ts';

const answering = { requestIdHeader: null, now: () => Date.parse('2026-10-29T09:00:00.000Z') };

const byteOrderMark = String.fromCodePoint(0xfe_ff);

const wordMediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const noReading =
  'The runtime reads no document here, since it was composed with no process to read one in, and it reads none in its own';

const unreadPng = 'The runtime does not read image/png as text; it reads text, PDF and Word documents';

function readInProcess(named?: string): AnsweredFile {
  return {
    named,
    read: (given, textBytes) => documentsReadInProcess(given, { deadlineMs: 30_000, signal: undefined, textBytes }),
  };
}

function textOf(settled: CallSettled): unknown {
  return 'result' in settled ? settled.result.content.map(({ text }) => text) : settled;
}

async function textsOf(...responses: readonly Readonly<Response>[]): Promise<readonly unknown[]> {
  const settled = await Promise.all(
    responses.map((response) => settledOf(response, answering, undefined, readInProcess())),
  );
  return settled.map((each) => textOf(each));
}

async function answeredText(response: Readonly<Response>): Promise<string> {
  const settled = await settledOf(response, answering, undefined, readInProcess());
  return 'result' in settled ? settled.result.content.map(({ text = '' }) => text).join('') : '';
}

async function namedText(headers: Readonly<Record<string, string>>, callNames?: string): Promise<unknown> {
  const response = new Response('Net 30', { headers: { 'content-type': 'text/plain', ...headers } });
  return textOf(await settledOf(response, answering, undefined, readInProcess(callNames)));
}

describe('an answer of an HTTP API that is not JSON', () => {
  it('is read as a document, its text after a line naming it, the type it was read as and its size', async () => {
    const texts = await textsOf(
      new Response(`${byteOrderMark}Found 2 rows.`, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
      new Response(pdfOfPages([['Net 30']]), {
        headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=a.pdf' },
      }),
    );

    expect(texts).toEqual([
      ['[The answer, text/plain, 16 bytes]\nFound 2 rows.'],
      [`[The file a.pdf, application/pdf, ${measured(pdfOfPages([['Net 30']]).byteLength)} bytes]\nNet 30`],
    ]);
  });

  it('of a type the runtime does not read, of none or of one not written as a type, answers the line and why', async () => {
    const texts = await textsOf(
      new Response('png', { headers: { 'content-type': 'image/png' } }),
      new Response(Uint8Array.of(1, 2)),
      new Response(Uint8Array.of(1, 2), { headers: { 'content-type': 'image png] [The file x' } }),
    );

    expect(texts).toEqual([
      [`[The answer, image/png, 3 bytes]\n${unreadPng}`],
      [
        '[The answer, application/octet-stream, 2 bytes]\nThe runtime does not read application/octet-stream as text; it reads text, PDF and Word documents',
      ],
      [
        '[The answer, application/octet-stream, 2 bytes]\nThe runtime does not read application/octet-stream as text; it reads text, PDF and Word documents',
      ],
    ]);
  });

  it('is read by nothing where no reading of documents was composed', async () => {
    expect(
      textOf(await settledOf(new Response('Net 30', { headers: { 'content-type': 'text/plain' } }), answering)),
    ).toEqual([`[The answer, text/plain, 6 bytes]\n${noReading}`]);
  });
});

describe('the reading of an answer of an HTTP API that is not JSON', () => {
  it('stops past what the runtime reads of a document, a failure of the call noted as too large', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(new Uint8Array(1_048_576));
      },
    });

    const settled = await settledOf(
      new Response(endless, { headers: { 'content-type': 'application/pdf' } }),
      answering,
      undefined,
      readInProcess(),
    );

    expect(settled).toMatchObject({ error: new DocumentTooLarge(), observed: { response: { tooLarge: true } } });
    expect(pulled).toBeLessThan(25);
  });

  it('answers text within the bytes one answer of an HTTP API may take, cut by its reading with a last line saying so', async () => {
    const written = 'x'.repeat(toolBounds.httpAnswerBytes + 1000);

    const text = await answeredText(new Response(written, { headers: { 'content-type': 'text/plain' } }));
    const line = `[The answer, text/plain, ${measured(written.length)} bytes]`;
    const lastLine = text.slice(text.lastIndexOf('\n') + 1);

    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(toolBounds.httpAnswerBytes);
    expect(text.startsWith(`${line}\nxxx`)).toBe(true);
    expect(lastLine).toBe(
      `[The text was cut to ${measured(text.length - lastLine.length - line.length - 2)} of its ${measured(written.length)} bytes, the most the runtime answers of a document here.]`,
    );
  });

  it('that breaks off is a failure of the call', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(Uint8Array.of(37, 80, 68, 70));
        controller.error(new Error('The connection was reset'));
      },
    });

    expect(await settledOf(new Response(broken), answering, undefined, readInProcess())).toMatchObject({
      error: new Error('The connection was reset'),
      observed: { response: { tooLarge: false } },
    });
  });
});

describe('the name of an answer of an HTTP API that is not JSON', () => {
  it('is the extended name its Content-Disposition writes before the plain one, in UTF-8 or ISO-8859-1', async () => {
    const named = await Promise.all([
      namedText({
        'content-disposition': `attachment; filename="terms.txt"; filename*=UTF-8''Supplier%20terms%20%E2%82%AC.txt`,
      }),
      namedText({ 'content-disposition': "attachment; filename*=iso-8859-1'en'caf%E9.txt" }),
    ]);

    expect(named).toEqual([
      ['[The file Supplier terms €.txt, text/plain, 6 bytes]\nNet 30'],
      ['[The file café.txt, text/plain, 6 bytes]\nNet 30'],
    ]);
  });

  it('is the plain name where the extended one does not decode, quoted or not', async () => {
    const named = await Promise.all([
      namedText({ 'content-disposition': `attachment; filename*=UTF-8''%E2; filename="fallback \\"one\\".txt"` }),
      namedText({ 'content-disposition': "attachment; filename*=koi8-r''x.txt; filename=plain.txt" }),
    ]);

    expect(named).toEqual([
      ['[The file fallback "one".txt, text/plain, 6 bytes]\nNet 30'],
      ['[The file plain.txt, text/plain, 6 bytes]\nNet 30'],
    ]);
  });
});

describe('the name shown of an answer of an HTTP API that is not JSON', () => {
  it('has as spaces the characters that would forge a line, a bracket or the order of the text, and at most 255 characters', async () => {
    const named = await Promise.all([
      namedText({ 'content-disposition': "attachment; filename*=UTF-8''a%0Ab%E2%80%A8c%E2%80%AEd%5D%20e" }),
      namedText({ 'content-disposition': `attachment; filename="${'n'.repeat(300)}.txt"` }),
    ]);

    expect(named).toEqual([
      ['[The file a b c d  e, text/plain, 6 bytes]\nNet 30'],
      [`[The file ${'n'.repeat(255)}, text/plain, 6 bytes]\nNet 30`],
    ]);
  });

  it('is what the call names where the answer names nothing, cleaned as well, and else the answer', async () => {
    const named = await Promise.all([
      namedText({ 'content-disposition': 'inline; filename=""' }, 'terms-7'),
      namedText({}, 'terms\n7'),
      namedText({}, ' '),
      namedText({}),
    ]);

    expect(named).toEqual([
      ['[The file terms-7, text/plain, 6 bytes]\nNet 30'],
      ['[The file terms 7, text/plain, 6 bytes]\nNet 30'],
      ['[The answer, text/plain, 6 bytes]\nNet 30'],
      ['[The answer, text/plain, 6 bytes]\nNet 30'],
    ]);
  });
});

describe('a file a tool of an HTTP API fetches through an access composed with no reading of documents', () => {
  it('is answered with the line and the words that no document is read', async () => {
    const fake = await fakeApi();
    const reporting = await describedAccess(
      { graph: { org: 'acme', ...keyed(fake) } },
      { environment: { GRAPH_API_KEY: apiKey }, documents: null },
    );
    closedAfter(reporting.access.close);

    expect(await called(reporting.access, 'file', { fileName: 'terms.txt' })).toMatchObject({
      outcome: 'result',
      answer: { content: [{ text: `[The file terms.txt, text/plain, 49 bytes]\n${noReading}` }] },
    });
  });
});

describe('a file a tool of an HTTP API fetches', () => {
  it('answers the text of a PDF, a Word document and a text file, after a line naming the file, its type and its size', async () => {
    const access = await accessTo(keyed(await fakeApi()));

    const answers = await Promise.all(
      ['terms.pdf', 'terms.docx', 'terms.txt'].map((fileName) => called(access, 'file', { fileName })),
    );

    expect(answers.map((answer) => answerOf(answer))).toEqual(
      [
        `[The file Supplier terms.pdf, application/pdf, ${measured(pdfOfPages([fakeFileTexts.pdf]).byteLength)} bytes]\n${fakeFileTexts.pdf.join('\n')}`,
        `[The file Supplier terms.docx, ${wordMediaType}, ${measured(wordDocumentOf(fakeFileTexts.word).byteLength)} bytes]\n${fakeFileTexts.word.join('\n\n')}`,
        `[The file terms.txt, text/plain, 49 bytes]\n${fakeFileTexts.text}`,
      ].map((text) => ({ content: [{ type: 'text', text }] })),
    );
  });

  it('answers the line and why for an image, a file larger than the runtime reads as too large, and a missing file as an error result', async () => {
    const access = await accessTo(keyed(await fakeApi()));

    const answers = await Promise.all(
      ['photo.png', 'large.pdf', 'gone.pdf'].map((fileName) => called(access, 'file', { fileName })),
    );

    expect(answers).toMatchObject([
      { outcome: 'result', answer: { content: [{ text: `[The file photo.png, image/png, 8 bytes]\n${unreadPng}` }] } },
      { outcome: 'too_large', detail: new DocumentTooLarge().message },
      { outcome: 'tool_error', detail: 'No file named gone.pdf' },
    ]);
  });
});
