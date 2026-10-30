import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';
import { publicUrl, signedInServer } from '../testing/signed-in.ts';

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
