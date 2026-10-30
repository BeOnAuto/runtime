import type { CallerIdentity } from '@on.auto/operations';
import { afterEach, describe, expect, it } from 'vitest';

import { playbookToolCalls, reportingAccess, toolCaller } from '../testing/index.ts';
import { serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>>) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
}

function searchingOn(servers: Readonly<Record<string, unknown>>) {
  const { access } = reportingAccess(servers, { environment: { GRAPH_API_KEY: apiKey } });
  closing.push(access.close);
  return playbookToolCalls(access);
}

async function twoServers() {
  const fake = await fakeServer();
  const calls = searchingOn({
    graph: remote(fake, { allowed: ['search', 'echo'] }),
    wiki: remote(fake, { allowed: ['search'] }),
  });
  return { fake, ...calls };
}

const graph = { name: 'graph', type: 'mcp', record_content: true, provider: null, tool_count: 2 };

const wiki = { name: 'wiki', type: 'mcp', record_content: true, provider: null, tool_count: 1 };

const searchOf = (server: string) => ({
  server,
  tool: 'search',
  summary: 'Finds the rows of the graph that match a query.',
  read_only: true,
});

const echoOf = (server: string) => ({ server, tool: 'echo', summary: 'Answers with its arguments.', read_only: false });

describe('search', () => {
  it('is a query of the playbook at GET /tool-servers/search that reaches the servers outside', async () => {
    const { registrations } = await twoServers();

    expect(registrations.search).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'search',
      route: { method: 'GET', path: '/tool-servers/search' },
      permissions: ['playbook:read'],
      reachesOutside: true,
      mayChangeOutside: false,
      reasons: ['invalid_input'],
    });
  });

  it('lists without terms the servers of the playbook, by name, and every tool each allows, in its order', async () => {
    const { call } = await twoServers();

    expect(await call('search', {})).toEqual({
      status: 'succeeded',
      output: {
        servers: [graph, wiki],
        tools: [searchOf('graph'), echoOf('graph'), searchOf('wiki')],
        scopes: ['graph', 'wiki'],
      },
    });
  });
});

describe('search kept to some tools', () => {
  it('keeps with only the tools their server marks read-only, or the others', async () => {
    const { call } = await twoServers();

    expect([await call('search', { only: 'read' }), await call('search', { only: 'write' })]).toMatchObject([
      {
        output: {
          servers: [{ ...graph, tool_count: 1 }, wiki],
          tools: [searchOf('graph'), searchOf('wiki')],
        },
      },
      {
        output: {
          servers: [
            { ...graph, tool_count: 1 },
            { ...wiki, tool_count: 0 },
          ],
          tools: [echoOf('graph')],
        },
      },
    ]);
  });

  it('searches one server alone, asking no other, and answers for a retired playbook as every read does', async () => {
    const { call } = await twoServers();

    expect(await call('search', { server: 'wiki' })).toMatchObject({
      output: { servers: [wiki], tools: [searchOf('wiki')], scopes: ['wiki'] },
    });
    expect(await call('search', {}, { playbook: 'old' })).toMatchObject({ status: 'succeeded' });
  });
});

describe('search across servers that cannot all be asked', () => {
  it('lists a server that cannot be asked beside the others, with why, and none of its tools', async () => {
    const fake = await fakeServer();
    const gone = await serveFakeMcp();
    await gone.close();
    const { call } = searchingOn({
      graph: remote(fake, { allowed: ['echo'] }),
      vault: remote(gone, {}),
    });

    expect(await call('search', {})).toMatchObject({
      output: {
        servers: [
          { ...graph, tool_count: 1 },
          { name: 'vault', type: 'mcp', record_content: true, because: 'unreachable' },
        ],
        tools: [echoOf('graph')],
        scopes: ['graph', 'vault'],
      },
    });
  });

  it('answers an empty search, without asking anything, when no server serves the playbook', async () => {
    const fake = await fakeServer();
    const { call } = searchingOn({ crm: remote(fake, { org: 'globex' }) });

    expect(await call('search', { terms: 'search' })).toEqual({
      status: 'succeeded',
      output: { servers: [], tools: [], scopes: [] },
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('search refusing', () => {
  it('rejects a playbook the org does not have, a name no server could have, and a caller who may not read', async () => {
    const { fake, call } = await twoServers();
    const writerOnly: CallerIdentity = { ...toolCaller, permissions: ['playbook:write'] };

    expect(await call('search', {}, { playbook: 'nowhere' })).toMatchObject({ reason: 'not_found' });
    expect(await call('search', { server: 'Graph/' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/server' }],
    });
    expect(await call('search', {}, { caller: writerOnly })).toMatchObject({ reason: 'forbidden' });
    expect(fake.seen()).toEqual([]);
  });

  it('rejects a name that no tool server of the playbook has, saying so and how to search the ones it has', async () => {
    const { fake, call } = await twoServers();
    const detail = 'This playbook has no tool server named mail; call search without server to search the ones it has';

    expect(await call('search', { server: 'mail' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail,
      issues: [{ detail, pointer: '/server' }],
    });
    expect(fake.seen()).toEqual([]);
  });
});
