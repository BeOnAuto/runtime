import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { messagesIn, postMcp, requestOf } from '../testing/mcp-requests.ts';
import { acmeAdmin } from '../testing/operation-server.ts';
import { publicUrl, signedInServer } from '../testing/signed-in.ts';

const rootMetadata = `${publicUrl}/.well-known/oauth-protected-resource`;

const signInScopes = 'user:org:read org:read org:write playbook:read playbook:write';

const everyPermission = 'org:read org:write playbook:read playbook:write';

const onTheCurrentRevision = { 'mcp-protocol-version': '2025-11-25' };

describe('a signed-in person over HTTP', () => {
  it('is admitted to the org the token names, with every permission over every playbook when granted every scope', async () => {
    const { server, bearer } = await signedInServer();
    const ofGlobex = await bearer({ org_id: 'globex' });

    expect([
      (await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', { headers: await bearer() })).status,
      (
        await call(server.handler, '/v1/orgs/acme/playbooks/beta/notes', {
          method: 'POST',
          headers: { ...(await bearer()), 'content-type': 'application/json' },
          body: '{"name":"a","text":"b"}',
        })
      ).status,
      (await call(server.handler, '/v1/orgs/globex/playbooks/gamma/notes', { headers: ofGlobex })).status,
    ]).toEqual([200, 201, 200]);
  });

  it('is refused another org with 403, naming the permission of the operation and the metadata', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/globex/playbook-labels', { headers: await bearer() });

    expect(answer).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'The caller does not belong to this org' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="org:read", resource_metadata="${rootMetadata}"`,
    );
  });

  it('sits beside the keys, which are verified as keys', async () => {
    const { server } = await signedInServer();

    expect(
      await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
        headers: { authorization: `Bearer ${acmeAdmin.key}` },
      }),
    ).toMatchObject({ status: 200 });
  });
});

describe('a signed-in person over MCP', () => {
  it('is refused another org with 403, naming the four permissions and the endpoint’s metadata', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await postMcp(server.handler, '/orgs/globex/mcp', await bearer());

    expect(answer.status).toBe(403);
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="insufficient_scope", scope="${everyPermission}", resource_metadata="${rootMetadata}/orgs/globex/mcp"`,
    );
  });

  it('is served on /mcp in the org the token names', async () => {
    const { server, bearer } = await signedInServer();

    const labelled = await postMcp(
      server.handler,
      '/mcp',
      { ...(await bearer({ org_id: 'globex' })), ...onTheCurrentRevision },
      requestOf(1, 'tools/call', { name: 'label_playbook', arguments: { playbook: 'gamma', label: 'signed-in' } }),
    );
    const labels = await call(server.handler, '/v1/orgs/globex/playbook-labels', {
      headers: await bearer({ org_id: 'globex' }),
    });

    expect(messagesIn(labelled)).toMatchObject([
      { result: { structuredContent: { playbook: 'gamma', label: 'signed-in' } } },
    ]);
    expect(labels.body).toEqual({ labels: [{ playbook: 'gamma', label: 'signed-in' }] });
  });
});

describe('a request without a valid token, with sign-in on', () => {
  it('is answered 401 with the metadata and every scope a sign-in asks for, and no error when nothing was presented', async () => {
    const { server } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes');

    expect(answer).toMatchObject({
      status: 401,
      body: { reason: 'unauthenticated', detail: 'A valid API key or access token is required' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${rootMetadata}", scope="${signInScopes}"`,
    );
  });
});

describe('a signed-in person whose token names no org, over HTTP', () => {
  it('is admitted to the org of their subject, and refused every other with 403', async () => {
    const { server, bearer } = await signedInServer();
    const namingNoOrg = await bearer({ org_id: undefined, sub: 'user_2ada' });

    expect([
      (await call(server.handler, '/v1/orgs/user_2ada/playbook-labels', { headers: namingNoOrg })).status,
      (await call(server.handler, '/v1/orgs/acme/playbook-labels', { headers: namingNoOrg })).status,
    ]).toEqual([200, 403]);
  });
});

describe('a token the runtime refuses, with sign-in on', () => {
  it('is answered 401 with invalid_token for an opaque token', async () => {
    const { server } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
      headers: { authorization: 'Bearer an-opaque-token' },
    });

    expect(answer).toMatchObject({
      status: 401,
      body: { reason: 'unauthenticated', detail: 'The token was refused: ERR_JWS_INVALID' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", resource_metadata="${rootMetadata}", scope="${signInScopes}"`,
    );
  });

  it.each([
    [
      'its org in o, not org_id',
      { org_id: undefined, o: { id: 'acme' } },
      'ERR_JWT_CLAIM_VALIDATION_FAILED on its org_id claim',
    ],
    ['no sub', { sub: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its sub claim'],
    ['an expired one', { exp: 1 }, 'ERR_JWT_EXPIRED on its exp claim'],
  ])(
    'says why it refused a token with %s, naming no value of it',
    async (_case, claims: Readonly<Record<string, unknown>>, words) => {
      const { server, bearer } = await signedInServer();

      const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
        headers: await bearer(claims),
      });

      expect(answer).toMatchObject({ status: 401, body: { detail: `The token was refused: ${words}` } });
    },
  );
});

describe('the audience of a token, with sign-in on', () => {
  it('is answered 401 for a token whose audience is another endpoint', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/notes', {
      headers: await bearer({ aud: `${publicUrl}/orgs/acme/mcp` }),
    });

    expect(answer.status).toBe(401);
  });

  it('takes a token for the endpoint it reached', async () => {
    const { server, bearer } = await signedInServer();

    const answer = await postMcp(server.handler, '/orgs/acme/mcp', await bearer({ aud: `${publicUrl}/orgs/acme/mcp` }));

    expect(answer.status).toBe(200);
  });
});
