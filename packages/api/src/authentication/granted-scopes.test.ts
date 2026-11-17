import { describe, expect, it } from 'vitest';

import { call, type Call } from '../testing/api-calls.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';
import { publicUrl, signedInServer } from '../testing/signed-in.ts';

type Headers = Readonly<Record<string, string>>;

const rootMetadata = `${publicUrl}/.well-known/oauth-protected-resource`;

const onTheCurrentRevision = { 'mcp-protocol-version': '2025-11-25' };

const alphaNotes = '/v1/orgs/acme/playbooks/alpha/notes';

function challengeNaming(scope: string): string {
  return `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${rootMetadata}"`;
}

function sent(method: string, body: string): (headers: Headers) => Call {
  return (headers) => ({ method, headers: { ...headers, 'content-type': 'application/json' }, body });
}

function read(headers: Headers): Call {
  return { headers };
}

const addingANote = sent('POST', '{"name":"a","text":"b"}');

const everyOperation: ReadonlyArray<readonly [string, string, string, (headers: Headers) => Call]> = [
  ['reading the notes of a playbook', alphaNotes, 'playbook:read', read],
  ['adding a note', alphaNotes, 'playbook:write', addingANote],
  ['listing the labels of the org', '/v1/orgs/acme/playbook-labels', 'org:read', read],
  ['labelling a playbook', '/v1/orgs/acme/playbooks/alpha/label', 'org:write', sent('PUT', '{"label":"b"}')],
];

describe('a signed-in person granted the two read scopes', () => {
  it('is served a read, and refused a write with 403 naming the permission it needs as the scope', async () => {
    const { server, bearer } = await signedInServer();
    const reader = await bearer({ scope: 'user:org:read org:read playbook:read' });

    const notes = await call(server.handler, alphaNotes, read(reader));
    const written = await call(server.handler, alphaNotes, addingANote(reader));

    expect(notes.status).toBe(200);
    expect(written).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller lacks the playbook:write permission' },
    });
    expect(written.headers.get('www-authenticate')).toBe(challengeNaming('playbook:write'));
  });
});

describe('a signed-in person granted none of the four permissions', () => {
  it.each(everyOperation)('is refused %s with 403 naming %s as the scope', async (_case, path, scope, request) => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, path, request(await bearer({ scope: 'user:org:read' })));

    expect(answer).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(answer.headers.get('www-authenticate')).toBe(challengeNaming(scope));
  });

  it('is still a person of the org the token names, offered no tool but the guide on /mcp', async () => {
    const { server, bearer } = await signedInServer();

    const listed = await postMcp(
      server.handler,
      '/mcp',
      { ...(await bearer({ scope: 'user:org:read' })), ...onTheCurrentRevision },
      requestOf(1, 'tools/list'),
    );

    expect(listed.status).toBe(200);
    expect(messagesIn(listed)).toMatchObject([{ result: { tools: [{ name: 'get_guide' }] } }]);
  });
});

describe('a signed-in person whose token holds the four permissions but not user:org:read', () => {
  it('is a person of the org its org_id names, since org_id is the check, and is served a write', async () => {
    const { server, bearer } = await signedInServer();
    const person = await bearer({ scope: 'org:read org:write playbook:read playbook:write' });

    expect((await call(server.handler, alphaNotes, addingANote(person))).status).toBe(201);
  });
});

const metadataPath = '/.well-known/oauth-protected-resource';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

describe('the protected resource metadata, with sign-in on', () => {
  it.each([
    ['', publicUrl],
    ['/mcp', `${publicUrl}/mcp`],
    ['/orgs/acme/mcp', `${publicUrl}/orgs/acme/mcp`],
    ['/orgs/acme/playbooks/alpha/mcp', `${publicUrl}/orgs/acme/playbooks/alpha/mcp`],
  ])(
    'is answered without a key at the root and under the endpoint %j, naming that resource',
    async (path, resource) => {
      const { server } = await signedInServer();

      const answer = await call(server.handler, `${metadataPath}${path}`, {
        headers: { origin: 'https://agent.example' },
      });

      expect(answer).toMatchObject({
        status: 200,
        body: {
          resource,
          authorization_servers: ['https://login.example'],
          bearer_methods_supported: ['header'],
          scopes_supported: ['user:org:read', 'org:read', 'org:write', 'playbook:read', 'playbook:write'],
          resource_documentation: 'https://on.auto/docs/reference/mcp',
        },
      });
      expect(answer.headers.get('cache-control')).toBe('no-store');
    },
  );

  it.each([
    `${metadataPath}/orgs/ac%20me/mcp`,
    `${metadataPath}/orgs/acme/playbooks/Alpha/mcp`,
    `${metadataPath}/v1/orgs/acme/playbooks`,
    `${metadataPath}/elsewhere`,
  ])('answers 404 without a key for %s, which names no endpoint', async (path) => {
    const { server } = await signedInServer();

    expect(await call(server.handler, path)).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });
});

describe('the paths around the protected resource metadata', () => {
  it('answers another method with 405 and Allow, without a key', async () => {
    const { server } = await signedInServer();

    const answer = await call(server.handler, metadataPath, { method: 'POST' });

    expect([answer.status, answer.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
  });

  it.each(['/.well-known/oauth-protected-resources', '/.well-known/oauth-authorization-server'])(
    'leaves %s, which only shares a prefix, behind a key',
    async (path) => {
      const { server } = await signedInServer();

      expect(await call(server.handler, path)).toMatchObject({ status: 401 });
    },
  );
});

describe('the protected resource metadata, with sign-in off', () => {
  it('is not served, and its path needs a key as every path does', async () => {
    const { handler } = await operationServer();

    const withoutKey = await call(handler, metadataPath);

    expect(withoutKey.status).toBe(401);
    expect(withoutKey.headers.get('www-authenticate')).toBe('Bearer');
    expect(await call(handler, metadataPath, { headers: asAdmin })).toMatchObject({ status: 404 });
  });

  it('leaves a refusal of scope as a bare insufficient_scope challenge', async () => {
    const { handler } = await operationServer();

    const answer = await call(handler, '/v1/orgs/globex/playbook-labels', { headers: asAdmin });

    expect(answer.status).toBe(403);
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="insufficient_scope"');
  });
});
