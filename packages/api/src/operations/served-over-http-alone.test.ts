import { describe, expect, it, onTestFinished } from 'vitest';

import type { ApiHandler } from '../index.ts';
import { call } from '../testing/api-calls.ts';
import { httpAloneOperations } from '../testing/http-alone-operations.ts';
import { exchanged, listenOnLoopback } from '../testing/listening.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

type Headers = Readonly<Record<string, string>>;

const asAdmin: Headers = { authorization: `Bearer ${acmeAdmin.key}` };

const asJson: Headers = { ...asAdmin, 'content-type': 'application/json' };

const blobs = '/v1/orgs/acme/playbooks/alpha/blobs';

function withBlobs() {
  return operationServer({ operations: [...notebookOperations, ...httpAloneOperations] });
}

async function listeningWithBlobs() {
  const server = await withBlobs();
  const listening = await listenOnLoopback(server.handler);
  onTestFinished(() => listening.close());
  return { ...server, origin: listening.origin };
}

describe('an operation served over HTTP alone, answering over the wire', () => {
  it('answers a query that takes no body, and a command whose body is JSON or none, with JSON that is not kept', async () => {
    const { origin } = await listeningWithBlobs();

    const read = await exchanged(origin, `${blobs}/b1?label=kept`, { headers: asAdmin });
    const unlabelled = await exchanged(origin, `${blobs}/b2`, { headers: asAdmin });
    const renamed = await exchanged(origin, `${blobs}/b1/rename`, {
      method: 'POST',
      headers: asJson,
      body: '{"to":"b2"}',
    });
    const cleared = await exchanged(origin, `${blobs}/clear`, { method: 'POST', headers: asAdmin });

    expect([read.status, JSON.parse(read.body), read.headers['content-type'], read.headers['cache-control']]).toEqual([
      200,
      { name: 'b1', text: 'kept' },
      'application/json',
      'no-store',
    ]);
    expect([
      JSON.parse(unlabelled.body),
      renamed.headers['content-type'],
      JSON.parse(renamed.body),
      JSON.parse(cleared.body),
    ]).toEqual([{ name: 'b2', text: 'blob b2' }, 'application/json', { renamed: 'b2' }, { cleared: true }]);
  });
});

describe('an operation served over HTTP alone, refusing what it was sent', () => {
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

  it('takes the fields of a query beside its path from its query string, and refuses one it does not take at its pointer', async () => {
    const { handler } = await withBlobs();

    const unknown = await call(handler, `${blobs}/b1?size=1`, { headers: asAdmin });
    const twice = await call(handler, `${blobs}/b1?name=b2`, { headers: asAdmin });

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
        httpAloneOperations.filter(({ registration }) => listed.includes(`"name":"${registration.name}"`)),
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
