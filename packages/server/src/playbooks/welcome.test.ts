import { plainTextIn, technicalTextIn, withMcpSession, type ToolResult } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { afterEach, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { servedStudioHomeOf, studioHostHomeOf, welcomeLinking } from '../testing/studios/welcome.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const acmeReader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const acmeAlphaWriter = createApiKey({
  id: 'acme-alpha',
  org: 'acme',
  permissions: allPermissions,
  playbooks: ['alpha'],
});

const withKeys = { API_KEYS: JSON.stringify([acmeAdmin.entry, acmeReader.entry, acmeAlphaWriter.entry]) };

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function listedOverMcp(headers: Readonly<Record<string, string>> = {}): Promise<ToolResult> {
  return withMcpSession('current revision', { url: `${server.origin}/mcp`, headers }, (session) =>
    session.callTool('list_playbooks', {}),
  );
}

describe('the welcome of an org with no playbooks', () => {
  it('is answered over HTTP beside the empty list, ending with the link to the Studio the runtime serves', async () => {
    server = await servingReasoning([]);

    const listed = await server.call('GET', '/v1/orgs/local/playbooks');

    expect([listed.status, listed.body]).toEqual([
      200,
      { playbooks: [], welcome: welcomeLinking(servedStudioHomeOf(server.origin)) },
    ]);
  });

  it('is the text of the result over MCP, whole, and its welcome', async () => {
    server = await servingReasoning([]);
    const welcomed = welcomeLinking(servedStudioHomeOf(server.origin));

    const result = await listedOverMcp();

    expect([plainTextIn(result), result.structuredContent, JSON.parse(technicalTextIn(result))]).toEqual([
      welcomed,
      { playbooks: [], welcome: welcomed },
      { playbooks: [], welcome: welcomed },
    ]);
  });

  it('links the Studio host where the runtime serves no Studio', async () => {
    server = await servingReasoning([], withKeys);

    const result = await listedOverMcp({ authorization: `Bearer ${acmeAdmin.key}` });

    expect(plainTextIn(result)).toBe(welcomeLinking(studioHostHomeOf(server.origin)));
  });

  it('is answered to no caller who may not make its first playbook, one that may only read or one limited to some playbooks', async () => {
    server = await servingReasoning([], withKeys);

    const answered = await Promise.all(
      [acmeReader.key, acmeAlphaWriter.key].map(
        async (key) => (await server.call('GET', '/v1/orgs/acme/playbooks', { key })).body,
      ),
    );
    const overMcp = await listedOverMcp({ authorization: `Bearer ${acmeReader.key}` });

    expect([...answered, overMcp.structuredContent]).toEqual([{ playbooks: [] }, { playbooks: [] }, { playbooks: [] }]);
    expect(plainTextIn(overMcp)).toBe('There is no playbook in use that this connection may see.');
  });
});

describe('an org with a playbook', () => {
  it('is answered no welcome, over HTTP or over MCP, whose text names its playbooks', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/local/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const overHttp = await server.call('GET', '/v1/orgs/local/playbooks');
    const overMcp = await listedOverMcp();

    expect([overHttp.body, overMcp.structuredContent]).toMatchObject([
      { playbooks: [{ id: 'alpha' }] },
      { playbooks: [{ id: 'alpha' }] },
    ]);
    expect([overHttp.text.includes('"welcome"'), technicalTextIn(overMcp).includes('"welcome"')]).toEqual([
      false,
      false,
    ]);
    expect(plainTextIn(overMcp)).toBe('There is 1 playbook: “Alpha”.');
  });
});
