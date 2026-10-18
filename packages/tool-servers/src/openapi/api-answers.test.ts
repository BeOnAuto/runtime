import { describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import type { CallSettled } from '../clients/server-client.ts';
import { failureOf } from '../clients/server-failures.ts';
import { settledOf } from './api-answers.ts';

const answering = { requestIdHeader: 'x-request-id', now: () => Date.parse('2026-10-13T09:00:00.000Z') };

function streamOf(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1_048_576).fill(120);
  let sent = 0;
  return new ReadableStream({
    pull: (controller) => {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

function resultOf(settled: CallSettled): unknown {
  return 'result' in settled ? settled.result : settled;
}

function failingOf(settled: CallSettled): unknown {
  return 'error' in settled ? [failureOf(settled.error), settled.observed.response?.retryAfterMs] : settled;
}

async function resultsOf(...responses: readonly Readonly<Response>[]): Promise<readonly unknown[]> {
  return (await Promise.all(responses.map((response) => settledOf(response, answering)))).map((each) => resultOf(each));
}

describe('an answer of an HTTP API that is shown', () => {
  it('of JSON is the structured content of the tool and its text, with the id the API gives the request', async () => {
    const settled = await settledOf(
      Response.json({ name: 'Ada' }, { headers: { 'x-request-id': 'request-7' } }),
      answering,
    );

    expect(settled).toEqual({
      result: { content: [{ type: 'text', text: '{"name":"Ada"}' }], structuredContent: { name: 'Ada' } },
      resultJson: '{"content":[{"type":"text","text":"{\\"name\\":\\"Ada\\"}"}],"structuredContent":{"name":"Ada"}}',
      observed: { id: null, response: { retryAfterMs: null, serverRequestId: 'request-7', tooLarge: false } },
    });
  });

  it('of text, or of JSON that does not parse, is text, and an empty one is no content', async () => {
    expect(
      await resultsOf(
        new Response('Found 2 rows.', { headers: { 'content-type': 'text/plain' } }),
        new Response('{', { headers: { 'content-type': 'application/json' } }),
        new Response(null, { status: 204 }),
      ),
    ).toEqual([
      { content: [{ type: 'text', text: 'Found 2 rows.' }] },
      { content: [{ type: 'text', text: '{' }] },
      { content: [] },
    ]);
  });
});

describe('an answer of an HTTP API that is not shown as it is', () => {
  it('of another media type, or of none, is noted and not shown', async () => {
    expect(
      await resultsOf(
        new Response('png', { headers: { 'content-type': 'image/png' } }),
        new Response(new Uint8Array([1, 2])),
      ),
    ).toEqual([{ content: [{ type: 'binary', mimeType: 'image/png' }] }, { content: [{ type: 'binary' }] }]);
  });

  it('of an error other than 401, 429 and 5xx is an error result carrying its body, or its status when it has none', async () => {
    expect(
      await resultsOf(
        new Response('{"title":"Not Found"}', { status: 404, headers: { 'content-type': 'application/problem+json' } }),
        new Response(null, { status: 409 }),
      ),
    ).toEqual([
      { content: [{ type: 'text', text: '{"title":"Not Found"}' }], isError: true },
      { content: [{ type: 'text', text: 'The tool server answered HTTP 409' }], isError: true },
    ]);
  });
});

describe('an answer of an HTTP API that redirects', () => {
  it('is an error result naming the redirect and its status, whatever its body', async () => {
    expect(
      await resultsOf(
        new Response('Moved', { status: 301, headers: { location: 'https://elsewhere.example.com/v1/search' } }),
        new Response(null, { status: 307, headers: { location: '/v2/search' } }),
      ),
    ).toEqual([
      {
        content: [
          { type: 'text', text: 'The tool server answered a redirect, HTTP 301, which a call does not follow' },
        ],
        isError: true,
      },
      {
        content: [
          { type: 'text', text: 'The tool server answered a redirect, HTTP 307, which a call does not follow' },
        ],
        isError: true,
      },
    ]);
  });
});

describe('an answer of an HTTP API that fails its call', () => {
  it('of 401, 429 or 5xx is a failure of the server, with the wait a 429 asks for', async () => {
    const statuses = [
      new Response('no', { status: 401 }),
      new Response('later', { status: 429, headers: { 'retry-after': '2' } }),
      new Response('down', { status: 503 }),
    ];

    const settled = await Promise.all(statuses.map((response) => settledOf(response, answering)));

    expect(settled.map((each) => failingOf(each))).toEqual([
      [{ kind: 'key_refused', message: 'The tool server answered HTTP 401' }, null],
      [{ kind: 'rate_limited', message: 'The tool server answered HTTP 429' }, 2000],
      [{ kind: 'failing', message: 'The tool server answered HTTP 503' }, null],
    ]);
  });

  it('larger than a call over HTTP may take is a failure noted as too large', async () => {
    const settled = await settledOf(
      new Response(streamOf(toolBounds.httpAnswerBytes + 1), { headers: { 'content-type': 'text/plain' } }),
      { requestIdHeader: null, now: Date.now },
    );

    expect(settled).toMatchObject({ observed: { id: null, response: { tooLarge: true, serverRequestId: null } } });
    expect(settled).toHaveProperty('error');
  });
});
