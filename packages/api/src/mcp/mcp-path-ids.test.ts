import { authenticatorFor } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { jsonOf, postMcp } from '../testing/mcp-requests.ts';
import { acmeAdmin, acmeAlphaWriter, operationServer } from '../testing/operation-server.ts';
import { publicUrl, signedInServer } from '../testing/signed-in.ts';

const rootChallenge = `Bearer error="insufficient_scope", scope="org:read org:write playbook:read playbook:write", resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`;

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

describe('an MCP path whose org id is not one, with sign-in on', () => {
  it.each([
    ['a quotation mark', '/orgs/x%22y/mcp'],
    ['a line break and a header', '/orgs/x%0d%0aSet-Cookie:%20a=b/mcp'],
    ['a line separator', '/orgs/%E2%80%A8/mcp'],
    ['a quotation mark in its playbook endpoint', '/orgs/x%22y/playbooks/alpha/mcp'],
  ])('refuses a caller of another org with 403 naming the root metadata, for %s', async (_case, path) => {
    const { server } = await signedInServer();

    const answer = await postMcp(server.handler, path, asAdmin);

    expect({ status: answer.status, reason: jsonOf(answer.text) }).toMatchObject({
      status: 403,
      reason: { reason: 'forbidden', detail: 'The caller does not belong to this org' },
    });
    expect(answer.headers.get('www-authenticate')).toBe(rootChallenge);
    expect(server.thrown()).toEqual([]);
  });

  it('refuses a playbook id that is not one, outside the caller’s playbooks, naming the root metadata', async () => {
    const { server } = await signedInServer();

    const answer = await postMcp(server.handler, '/orgs/acme/playbooks/x%22y/mcp', {
      authorization: `Bearer ${acmeAlphaWriter.key}`,
    });

    expect(answer.status).toBe(403);
    expect(answer.headers.get('www-authenticate')).toBe(rootChallenge);
  });
});

describe('an MCP path whose id is not one, from a caller who may reach any', () => {
  it('answers a playbook id that is not one with 404, as an operation route does, before any hand-off', async () => {
    const { handler, mcpErrors, thrown } = await operationServer();

    const answer = await postMcp(handler, '/orgs/acme/playbooks/x%22y/mcp', asAdmin);

    expect([answer.status, jsonOf(answer.text)]).toMatchObject([
      404,
      { reason: 'not_found', detail: 'There is no such playbook in this org' },
    ]);
    expect(answer.headers.get('www-authenticate')).toBeNull();
    expect([mcpErrors(), thrown()]).toEqual([[], []]);
  });

  it('answers an org id that is not one with 404, as an operation route does', async () => {
    const { handler } = await operationServer({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
    });

    const answer = await postMcp(handler, '/orgs/x%22y/mcp', { host: 'localhost:5555' });

    expect([answer.status, jsonOf(answer.text)]).toMatchObject([
      404,
      { reason: 'not_found', detail: 'There is no such org' },
    ]);
  });
});
