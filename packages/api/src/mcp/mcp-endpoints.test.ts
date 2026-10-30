import { authenticatorFor } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { jsonOf, postMcp } from '../testing/mcp-requests.ts';
import { acmeAdmin, acmeAlphaWriter, globexAdmin, operationServer } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const mebibyte = 1024 * 1024;

function forbiddenProblem(detail: string): Readonly<Record<string, unknown>> {
  return { type: 'https://on.auto/problems/forbidden', title: 'Forbidden', status: 403, detail, reason: 'forbidden' };
}

function pingWithPadding(size: number): string {
  return JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1, padding: 'a'.repeat(size) });
}

function sdkError(message: string): Readonly<Record<string, unknown>> {
  return { jsonrpc: '2.0', error: { code: -32_000, message }, id: null };
}

const otherCallers: ReadonlyArray<readonly [string, string, string, string]> = [
  ['another org', '/orgs/globex/mcp', acmeAdmin.key, 'The caller does not belong to this org'],
  [
    'a playbook of another org',
    '/orgs/acme/playbooks/alpha/mcp',
    globexAdmin.key,
    'The caller does not belong to this org',
  ],
  [
    'a playbook outside the key',
    '/orgs/acme/playbooks/beta/mcp',
    acmeAlphaWriter.key,
    'The caller may not access this playbook',
  ],
];

describe('the callers an MCP endpoint rejects before the MCP SDK runs', () => {
  it('answers a request without a key with a 401 problem document and a Bearer challenge', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', {});

    expect({ status: answer.status, type: answer.headers.get('content-type') }).toEqual({
      status: 401,
      type: 'application/problem+json',
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer');
  });

  it.each(otherCallers)('rejects a key on %s with a 403 problem document', async (_case, path, key, detail) => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, path, { authorization: `Bearer ${key}` });

    expect({ status: answer.status, body: jsonOf(answer.text) }).toEqual({
      status: 403,
      body: forbiddenProblem(detail),
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope"');
  });
});

describe('credentials of a scheme the API does not know, at an MCP endpoint', () => {
  it.each(['/mcp', '/orgs/acme/mcp', '/orgs/acme/playbooks/alpha/mcp'])(
    'refuses a Request header on %s as a malformed Authorization header, as over HTTP',
    async (path) => {
      const { handler } = await operationServer();

      const answer = await postMcp(handler, path, { authorization: 'Request a-token-of-a-request' });

      expect({ status: answer.status, body: jsonOf(answer.text) }).toMatchObject({
        status: 400,
        body: {
          reason: 'bad_request',
          detail: 'The Authorization header must hold exactly one API key or access token, as Bearer <key or token>',
        },
      });
      expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_request"');
    },
  );
});

describe('the origins an MCP endpoint rejects', () => {
  it('rejects an origin that is not allowed with a 403 problem document', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', { ...asAdmin, origin: 'https://evil.example' });

    expect({ status: answer.status, body: jsonOf(answer.text) }).toMatchObject({
      status: 403,
      body: { reason: 'origin_not_allowed' },
    });
  });
});

describe('the methods of an MCP endpoint', () => {
  it.each(['GET', 'DELETE', 'PUT'])('answers %s with 405, a problem document and Allow: POST', async (method) => {
    const { handler } = await operationServer();

    const answer = await call(handler, '/orgs/acme/mcp', { method, headers: asAdmin });

    expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(answer.headers.get('allow')).toBe('POST');
  });

  it('answers HEAD with 405 and Allow: POST', async () => {
    const { handler } = await operationServer();

    const answer = await call(handler, '/orgs/acme/playbooks/alpha/mcp', { method: 'HEAD', headers: asAdmin });

    expect({ status: answer.status, allow: answer.headers.get('allow') }).toEqual({ status: 405, allow: 'POST' });
  });
});

describe('an MCP endpoint once the MCP SDK runs', () => {
  it('answers a body that is not JSON with the SDK’s own JSON-RPC error and 415, and reports it', async () => {
    const { handler, mcpErrors } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', { ...asAdmin, 'content-type': 'text/plain' });

    expect({ status: answer.status, type: answer.headers.get('content-type'), body: jsonOf(answer.text) }).toEqual({
      status: 415,
      type: 'application/json',
      body: sdkError('Unsupported Media Type: Content-Type must be application/json'),
    });
    expect(mcpErrors()).toEqual(['Unsupported Media Type: Content-Type must be application/json']);
  });

  it('answers a body over 1 MiB with the SDK’s own JSON-RPC error and 413, and accepts one at the limit', async () => {
    const { handler } = await operationServer();
    const envelope = pingWithPadding(0).length;

    const over = await postMcp(handler, '/orgs/acme/mcp', asAdmin, pingWithPadding(mebibyte - envelope + 1));
    const atLimit = await postMcp(handler, '/orgs/acme/mcp', asAdmin, pingWithPadding(mebibyte - envelope));

    expect({ status: over.status, body: jsonOf(over.text) }).toEqual({
      status: 413,
      body: sdkError('Payload Too Large: Request body must not exceed 1048576 bytes'),
    });
    expect(atLimit.status).not.toBe(413);
  });

  it('answers a client that does not accept an event stream with the SDK’s own JSON-RPC error and 406', async () => {
    const { handler } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/mcp', { ...asAdmin, accept: 'application/json' });

    expect({ status: answer.status, body: jsonOf(answer.text) }).toEqual({
      status: 406,
      body: sdkError('Not Acceptable: Client must accept both application/json and text/event-stream'),
    });
  });

  it('admits the local developer in local mode without a key', async () => {
    const { handler } = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
    });

    const answer = await postMcp(handler, '/orgs/acme/mcp', { host: 'localhost:5555' });

    expect(answer.status).toBe(200);
    expect(answer.text).toContain('"serverInfo":{"name":"@on.auto/runtime"');
  });
});
