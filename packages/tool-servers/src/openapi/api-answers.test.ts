import { documentsReadInProcess } from '@on.auto/documents/testing';
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

  it('of JSON that does not parse is text, and an empty one is no content, whatever its type', async () => {
    expect(
      await resultsOf(
        new Response('{', { headers: { 'content-type': 'application/json' } }),
        new Response(null, { status: 204 }),
        new Response('', { headers: { 'content-type': 'text/plain' } }),
      ),
    ).toEqual([{ content: [{ type: 'text', text: '{' }] }, { content: [] }, { content: [] }]);
  });
});

describe('an answer of an HTTP API that is not shown as it is', () => {
  it('of no media type and an empty body, as a 201 that says nothing more, is no content and no document', async () => {
    const empty = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.close();
      },
    });

    expect(await resultsOf(new Response(empty, { status: 201 }))).toEqual([{ content: [] }]);
  });

  it('of an error other than 401, 429 and 5xx is an error result carrying its body, of any type and never read as a document, or its status when it has none', async () => {
    expect(
      await resultsOf(
        new Response('{"title":"Not Found"}', { status: 404, headers: { 'content-type': 'application/problem+json' } }),
        new Response('<p>Gone</p>', { status: 410, headers: { 'content-type': 'text/html' } }),
        new Response(null, { status: 409 }),
      ),
    ).toEqual([
      { content: [{ type: 'text', text: '{"title":"Not Found"}' }], isError: true },
      { content: [{ type: 'text', text: '<p>Gone</p>' }], isError: true },
      { content: [{ type: 'text', text: 'The tool server answered HTTP 409' }], isError: true },
    ]);
  });
});

const describingAnId = { schemas: [], components: {}, headers: { '2XX': ['X-Id'] } };

const readInProcess = {
  named: undefined,
  read: (given: Parameters<typeof documentsReadInProcess>[0], textBytes: number) =>
    documentsReadInProcess(given, { deadlineMs: 30_000, signal: undefined, textBytes }),
};

describe('the headers an operation describes for its successful answers', () => {
  it('are carried beside a body or a document’s text, alone where the body is empty, by the range of statuses they are described for, and nothing where the answer holds none', async () => {
    const answered = { 'x-id': 'id-1' };
    const savedDocument = '[The answer, text/plain, 6 bytes]\nSaved.';
    const settled = await Promise.all([
      settledOf(
        new Response('Saved.', { headers: { ...answered, 'content-type': 'text/plain' } }),
        answering,
        describingAnId,
        readInProcess,
      ),
      settledOf(new Response(null, { status: 201, headers: answered }), answering, describingAnId),
      settledOf(Response.json({ saved: true }), answering, describingAnId),
    ]);

    expect(settled.map((each) => resultOf(each))).toEqual([
      {
        content: [{ type: 'text', text: JSON.stringify({ headers: { 'X-Id': 'id-1' }, body: savedDocument }) }],
        structuredContent: { headers: { 'X-Id': 'id-1' }, body: savedDocument },
      },
      {
        content: [{ type: 'text', text: '{"headers":{"X-Id":"id-1"}}' }],
        structuredContent: { headers: { 'X-Id': 'id-1' } },
      },
      { content: [{ type: 'text', text: '{"saved":true}' }], structuredContent: { saved: true } },
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

  it('of JSON larger than a call over HTTP may take is a failure noted as too large', async () => {
    const settled = await settledOf(
      new Response(streamOf(toolBounds.httpAnswerBytes + 1), { headers: { 'content-type': 'application/json' } }),
      { requestIdHeader: null, now: Date.now },
    );

    expect(settled).toMatchObject({ observed: { id: null, response: { tooLarge: true, serverRequestId: null } } });
    expect(settled).toHaveProperty('error');
  });
});

describe('an answer of an HTTP API that refuses the scope of its credential', () => {
  it('of 403 whose challenge or body names insufficient_scope is a failure of the call naming the scope the challenge names', async () => {
    const statuses = [
      new Response('no', {
        status: 403,
        headers: { 'www-authenticate': 'Bearer error="insufficient_scope", scope="notes.write"' },
      }),
      new Response('{"error":"insufficient_scope"}', { status: 403 }),
    ];

    const settled = await Promise.all(statuses.map((response) => settledOf(response, answering)));

    expect(settled.map((each) => failingOf(each))).toEqual([
      [
        {
          kind: 'scope_lacking',
          message:
            'The tool server answered HTTP 403: the credential lacks the scope notes.write this request needs; a credential granted that scope would allow it',
        },
        null,
      ],
      [
        {
          kind: 'scope_lacking',
          message:
            'The tool server answered HTTP 403: the credential lacks a scope this request needs; a credential granted that scope would allow it',
        },
        null,
      ],
    ]);
  });

  it('of 403 for another reason is an error result carrying its body', async () => {
    expect(await resultsOf(new Response('{"error":"forbidden"}', { status: 403 }))).toEqual([
      { content: [{ type: 'text', text: '{"error":"forbidden"}' }], isError: true },
    ]);
  });
});
