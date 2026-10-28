import { describe, expect, it, onTestFinished } from 'vitest';

import type { ApiHandler } from '../index.ts';
import { call } from '../testing/api-calls.ts';
import { blobOperations } from '../testing/blob-operations.ts';
import { exchanged, listenOnLoopback } from '../testing/listening.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

type Headers = Readonly<Record<string, string>>;

const asAdmin: Headers = { authorization: `Bearer ${acmeAdmin.key}` };

const asJson: Headers = { ...asAdmin, 'content-type': 'application/json' };

const asOctets: Headers = { ...asAdmin, 'content-type': 'application/octet-stream' };

const blobs = '/v1/orgs/acme/playbooks/alpha/blobs';

const servedOverHttpAlone = blobOperations;

function withBlobs() {
  return operationServer({ operations: [...notebookOperations, ...servedOverHttpAlone] });
}

async function listeningWithBlobs() {
  const server = await withBlobs();
  const listening = await listenOnLoopback(server.handler);
  onTestFinished(() => listening.close());
  return { ...server, origin: listening.origin };
}

interface Streamed {
  readonly body: string;
  readonly method: string;
  readonly path: string;
  readonly contentType: string;
  readonly mediaType: string;
}

const streamedBodies: readonly Streamed[] = [
  {
    body: 'an octet stream',
    method: 'POST',
    path: `${blobs}/b1`,
    contentType: 'application/octet-stream',
    mediaType: 'application/octet-stream',
  },
  {
    body: 'CSV in UTF-8',
    method: 'PUT',
    path: '/v1/orgs/acme/playbooks/alpha/rows/r1',
    contentType: 'text/csv; charset=utf-8',
    mediaType: 'text/csv',
  },
];

describe('an operation served over HTTP alone, taking a stream over the wire', () => {
  it.each(streamedBodies)(
    'hands its handler $body as a stream with its media type and length, and answers with that stream, its media type and its length',
    async ({ method, path, contentType, mediaType }) => {
      const { origin } = await listeningWithBlobs();

      const answer = await exchanged(origin, path, {
        method,
        headers: { ...asAdmin, 'content-type': contentType, 'content-length': '10' },
        body: 'series,day',
      });

      expect([answer.status, answer.body, answer.whole]).toEqual([200, 'series,day', true]);
      expect([answer.headers['content-type'], answer.headers['content-length']]).toEqual([mediaType, '10']);
    },
  );

  it('answers an empty body sent with a Content-Length of 0 as an empty stream, over the wire and from a request in process that carries none', async () => {
    const { origin, handler } = await listeningWithBlobs();
    const sent = { method: 'POST', headers: { ...asOctets, 'content-length': '0' } };

    const answer = await exchanged(origin, `${blobs}/b1`, sent);
    const inProcess = await call(handler, `${blobs}/b1`, sent);

    expect([answer.status, answer.body, answer.headers['content-length'], answer.whole]).toEqual([200, '', '0', true]);
    expect([inProcess.status, inProcess.text]).toEqual([200, '']);
  });
});

describe('an operation served over HTTP alone, answering over the wire', () => {
  it('answers a query that takes no body with the stream it makes, in the media type its answer declares, and JSON where its answer is JSON', async () => {
    const { origin } = await listeningWithBlobs();

    const read = await exchanged(origin, `${blobs}/b1`, { headers: asAdmin });
    const renamed = await exchanged(origin, `${blobs}/b1/rename`, {
      method: 'POST',
      headers: asJson,
      body: '{"to":"b2"}',
    });
    const cleared = await exchanged(origin, `${blobs}/clear`, { method: 'POST', headers: asAdmin });

    expect([read.status, read.body, read.headers['content-type'], read.headers['cache-control']]).toEqual([
      200,
      'blob b1',
      'text/plain',
      'no-store',
    ]);
    expect([renamed.headers['content-type'], JSON.parse(renamed.body), JSON.parse(cleared.body)]).toEqual([
      'application/json',
      { renamed: 'b2' },
      { cleared: true },
    ]);
  });
});

describe('an operation served over HTTP alone, refusing a body', () => {
  it('refuses a body without a Content-Length with 411, and one longer than it takes with 413, while the body is still unsent', async () => {
    const { origin } = await listeningWithBlobs();

    const withoutLength = await exchanged(origin, `${blobs}/b1`, {
      method: 'POST',
      headers: { ...asOctets, 'transfer-encoding': 'chunked' },
      bodyLeftOpen: true,
    });
    const tooLong = await exchanged(origin, `${blobs}/b1`, {
      method: 'POST',
      headers: { ...asOctets, 'content-length': '1025' },
      bodyLeftOpen: true,
    });

    expect([withoutLength.status, JSON.parse(withoutLength.body)]).toEqual([
      411,
      expect.objectContaining({ reason: 'length_required', detail: 'A body must be sent with a Content-Length' }),
    ]);
    expect([tooLong.status, JSON.parse(tooLong.body)]).toEqual([
      413,
      expect.objectContaining({
        reason: 'content_too_large',
        detail: 'The body is larger than the 1,024 bytes this operation takes',
      }),
    ]);
  });
});

describe('an operation served over HTTP alone, refusing what it was sent', () => {
  it.each<readonly [string, Headers, number, string]>([
    ['another media type', { 'content-type': 'text/csv' }, 415, 'A body must be sent as application/octet-stream'],
    [
      'a Content-Encoding',
      { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip' },
      415,
      'A body must be sent without a Content-Encoding other than identity',
    ],
    [
      'a charset other than UTF-8',
      { 'content-type': 'application/octet-stream; charset=latin1' },
      415,
      'A body must be encoded as UTF-8',
    ],
    [
      'a Content-Length that is not a number',
      { 'content-type': 'application/octet-stream', 'content-length': 'ten' },
      400,
      'The Content-Length must be a whole number of bytes',
    ],
  ])('refuses a body sent with %s', async (_case, sent, status, detail) => {
    const { handler } = await withBlobs();

    const answer = await call(handler, `${blobs}/b1`, { method: 'POST', headers: { ...asAdmin, ...sent }, body: 'x' });

    expect(answer).toMatchObject({ status, body: { detail } });
  });

  it('refuses a body sent to a command that takes none, and a query string on a command whose body is JSON', async () => {
    const { handler } = await withBlobs();

    const withBody = await call(handler, `${blobs}/clear`, { method: 'POST', headers: asJson, body: '{}' });
    const withQuery = await call(handler, `${blobs}/b1/rename?size=1`, { method: 'POST', headers: asJson, body: '{}' });

    expect([withBody.status, withBody.body]).toEqual([
      400,
      expect.objectContaining({ reason: 'bad_request', detail: 'This operation takes no body' }),
    ]);
    expect(withQuery.status).toBe(400);
  });
});

describe('an operation served over HTTP alone, taking fields beside its streamed body', () => {
  it('takes the other fields of a command whose body streams from its query string, and refuses one it does not take at its pointer', async () => {
    const { handler, origin } = await listeningWithBlobs();
    const sent = { method: 'POST', headers: { ...asOctets, 'content-length': '1' }, body: 'x' };

    const labelled = await exchanged(origin, `${blobs}/b1?label=kept`, sent);
    const unknown = await call(handler, `${blobs}/b1?size=1`, sent);
    const twice = await call(handler, `${blobs}/b1?name=b2`, sent);

    expect([labelled.status, labelled.body]).toEqual([200, 'kept']);
    expect(unknown).toMatchObject({ status: 422, body: { reason: 'invalid_input', errors: [{ pointer: '/size' }] } });
    expect(twice).toMatchObject({ status: 400, body: { detail: 'The field name is given in more than one place' } });
  });
});

const endpoints = ['/mcp', '/orgs/acme/mcp', '/orgs/acme/playbooks/alpha/mcp'];

async function listingOn(handler: ApiHandler, path: string): Promise<string> {
  return (await postMcp(handler, path, asAdmin, requestOf(1, 'tools/list'))).text;
}

describe('an operation served over HTTP alone, over MCP', () => {
  it.each(endpoints)(
    'is listed on no endpoint, so %s lists the same bytes and tools it lists without it',
    async (path) => {
      const without = await operationServer();
      const withThem = await withBlobs();

      const listed = await listingOn(withThem.handler, path);

      expect(listed).toBe(await listingOn(without.handler, path));
      expect(
        servedOverHttpAlone.filter(({ registration }) => listed.includes(`"name":"${registration.name}"`)),
      ).toEqual([]);
    },
  );

  it('is refused as a tool call, as a tool the endpoint does not list', async () => {
    const { handler } = await withBlobs();

    const answers = await Promise.all(
      ['/orgs/acme/playbooks/alpha/mcp', '/mcp'].map((path) =>
        postMcp(handler, path, asAdmin, requestOf(2, 'tools/call', { name: 'read_blob', arguments: { name: 'b1' } })),
      ),
    );

    expect(answers.flatMap((answer) => messagesIn(answer))).toEqual([
      { jsonrpc: '2.0', id: 2, error: { code: -32_602, message: 'Tool read_blob not found' } },
      { jsonrpc: '2.0', id: 2, error: { code: -32_602, message: 'Tool read_blob not found' } },
    ]);
  });
});
