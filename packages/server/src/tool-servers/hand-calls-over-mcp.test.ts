import { listedTools, plainTextIn, problemIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
}

async function serving(): Promise<Serving> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const server = await servingReasoning([], {
    API_KEYS: JSON.stringify([builder.entry, reader.entry]),
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: builder.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return { server, graph };
}

function on<T>(server: ReasoningServer, path: string, key: string, use: (session: McpSession) => Promise<T>) {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}${path}`, headers: { authorization: `Bearer ${key}` } },
    use,
  );
}

const searched = { server: 'graph', tool: 'search', arguments: { query: 'acme' } };

const answered = { server: 'graph', tool: 'search', outcome: 'result', text: 'Found 2 rows for acme.' };

describe('execute over MCP', () => {
  it('is served on /mcp with the playbook as an argument and on the playbook endpoint, never on the org endpoint', async () => {
    const { server } = await serving();

    const called = await on(server, '/mcp', builder.key, (session) =>
      session.callTool('execute', { playbook: 'alpha', ...searched }),
    );
    const onThePlaybook = await on(server, '/orgs/acme/playbooks/alpha/mcp', builder.key, (session) =>
      session.callTool('execute', searched),
    );
    const onTheOrg = await on(server, '/orgs/acme/mcp', builder.key, (session) => session.listTools());

    expect([called.structuredContent, onThePlaybook.structuredContent]).toMatchObject([answered, answered]);
    expect(plainTextIn(called)).toMatch(
      /^The search tool of graph answered in [\d,]+ ms with \d+ bytes; what a reasoning function's model would see is in the details\.$/u,
    );
    expect(listedTools(onTheOrg).map(({ name }) => name)).not.toContain('execute');
  });

  it('says that a call may change something outside, while a tool server is configured', async () => {
    const { server } = await serving();

    const listed = await on(server, '/mcp', builder.key, async (session) => listedTools(await session.listTools()));

    expect(listed.find(({ name }) => name === 'execute')?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });
});

describe('execute refused over MCP', () => {
  it('says to name a tool server that search shows when none of the name serves the playbook', async () => {
    const { server, graph } = await serving();

    const refused = await on(server, '/orgs/acme/playbooks/alpha/mcp', builder.key, (session) =>
      session.callTool('execute', { server: 'wiki', tool: 'search' }),
    );

    expect(refused.isError).toBe(true);
    expect(problemIn(refused)).toMatchObject({ kind: 'tool_not_offered', because: 'tool_server_not_configured' });
    expect(plainTextIn(refused)).toBe(
      'Could not call the search tool of wiki: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook. Nothing was changed. This can be put right on your side: search shows the tool servers this playbook may use, so naming one of those can work.',
    );
    expect(graph.seen()).toEqual([]);
  });
});

describe('execute for a key that may only read', () => {
  it('is not offered on either endpoint, while search, introspect and dry_run are', async () => {
    const { server } = await serving();

    const offered: readonly (readonly string[])[] = await Promise.all(
      ['/mcp', '/orgs/acme/playbooks/alpha/mcp'].map((path) =>
        on(server, path, reader.key, async (session) => listedTools(await session.listTools()).map(({ name }) => name)),
      ),
    );

    expect(offered.map((names) => names.includes('execute'))).toEqual([false, false]);
    expect(offered.map((names) => ['search', 'introspect', 'dry_run'].every((name) => names.includes(name)))).toEqual([
      true,
      true,
    ]);
  });
});

describe('a call made by hand whose caller goes away over MCP while the tool is called', () => {
  it('records a start and no answer, sends no second call, and still lets the session go', async () => {
    const { server, graph } = await serving();
    const leaving = new AbortController();
    const call = { name: 'execute', arguments: { server: 'graph', tool: 'sleep', arguments: { ms: 5000 } } };

    const gone: Promise<unknown> = fetch(`${server.origin}/orgs/acme/playbooks/alpha/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${builder.key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: call }),
      signal: leaving.signal,
    }).catch((error: unknown) => error);
    await until(
      () => graph.received().length,
      (received) => received === 1,
    );
    leaving.abort();
    await gone;

    expect(
      await until(
        () => graph.endedSessions(),
        (ended) => ended === 1,
      ),
    ).toBe(1);
    const events = await server.call('GET', `${alpha}/events?order=asc`, { key: builder.key });
    expect(events.body).toMatchObject({ events: [{ type: 'tool_call_started' }] });
    expect(events.body).not.toMatchObject({ events: [{}, {}] });
    expect(graph.received()).toHaveLength(1);
  });
});
