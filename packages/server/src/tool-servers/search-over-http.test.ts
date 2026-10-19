import { listedTools, plainTextIn, problemIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { offeredByTheServer } from '../testing/servers/connected-servers.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
  readonly others: FakeMcpServer;
}

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, changes: Readonly<Record<string, unknown>>) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, ...changes };
}

async function serving(): Promise<Serving> {
  const graph = await fakeServer();
  const others = await fakeServer();
  const gone = await serveFakeMcp();
  await gone.close();
  const server = await servingReasoning([], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': 'production-eu' },
        org: 'acme',
        allowed: ['search', 'echo'],
      },
      crm: remote(others, { org: 'globex' }),
      sales: remote(others, { org: 'acme', playbooks: ['sales'] }),
      wiki: { url: gone.url, org: 'acme', playbooks: ['alpha'], record_content: false },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return { server, graph, others };
}

const graphOfAlpha = { name: 'graph', type: 'mcp', record_content: true, provider: null, tool_count: 2 };

const wikiOfAlpha = {
  name: 'wiki',
  type: 'mcp',
  record_content: false,
  provider: null,
  unavailable: 'The tool server wiki could not be used: The tool server could not be reached',
  because: 'unreachable',
};

const searchTool = {
  server: 'graph',
  tool: 'search',
  summary: 'Finds the rows of the graph that match a query.',
  read_only: true,
};

const echoTool = { server: 'graph', tool: 'echo', summary: 'Answers with its arguments.', read_only: false };

const foundForAlpha = {
  servers: [graphOfAlpha, wikiOfAlpha],
  tools: [searchTool, echoTool],
  scopes: ['graph', 'wiki'],
};

const foundInWords =
  "This playbook's functions may use 2 tool servers. “graph” offers 2 tools: search and echo. “wiki” could not be asked for its tools just now.";

function onPlaybook<T>(server: ReasoningServer, playbook: string, use: (session: McpSession) => Promise<T>) {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/${playbook}/mcp`, headers: {} },
    use,
  );
}

describe('search over HTTP', () => {
  it('lists the servers the playbook may use, with the tools the operator allows, and one it cannot reach as unavailable', async () => {
    const { server, graph, others } = await serving();

    const found = await server.call('GET', `${alpha}/tool-servers/search`);
    const named = await server.call('GET', `${alpha}/tool-servers/search?server=wiki`);

    expect(found).toMatchObject({ status: 200, body: foundForAlpha });
    expect(named).toMatchObject({ status: 200, body: { servers: [wikiOfAlpha], tools: [], scopes: ['wiki'] } });
    expect(graph.openSessions()).toBe(0);
    expect(others.seen()).toEqual([]);
  });

  it('finds tools by the terms of its query string, and keeps those that only read', async () => {
    const { server } = await serving();

    const byTerms = await server.call(
      'GET',
      `${alpha}/tool-servers/search?terms=${encodeURIComponent('its arguments')}`,
    );
    const reading = await server.call('GET', `${alpha}/tool-servers/search?only=read`);

    expect(byTerms).toMatchObject({ status: 200, body: { tools: [echoTool] } });
    expect(reading).toMatchObject({
      status: 200,
      body: { servers: [{ ...graphOfAlpha, tool_count: 1 }, wikiOfAlpha], tools: [searchTool] },
    });
  });

  it('shows no header value and no secret of a server', async () => {
    const { server, graph } = await serving();

    const { body } = await server.call('GET', `${alpha}/tool-servers/search`);
    const text = JSON.stringify(body);

    expect([apiKey, 'production-eu', 'Bearer', graph.url].filter((secret) => text.includes(secret))).toEqual([]);
  });

  it('answers a playbook the org does not have as not_found, and a retired playbook as every read does', async () => {
    const { server } = await serving();

    const missing = await server.call('GET', '/v1/orgs/acme/playbooks/nowhere/tool-servers/search');
    await server.call('POST', `${alpha}/retire`);
    const retired = await server.call('GET', `${alpha}/tool-servers/search`);

    expect(missing).toMatchObject({ status: 404, body: { reason: 'not_found' } });
    expect(retired).toMatchObject({ status: 200, body: foundForAlpha });
  });
});

function refusedAs(name: string) {
  return {
    status: 422,
    body: {
      reason: 'invalid_input',
      errors: [
        {
          detail: `This playbook has no tool server named ${name}; call search without server to search the ones it has`,
          pointer: '/server',
        },
      ],
    },
  };
}

describe('search over HTTP, asked for one server', () => {
  it('refuses the name of a server of another org, or of other playbooks of the org, and asks no server', async () => {
    const { server, graph, others } = await serving();

    const otherOrg = await server.call('GET', `${alpha}/tool-servers/search?server=crm`);
    const otherPlaybook = await server.call('GET', `${alpha}/tool-servers/search?server=sales`);

    expect(otherOrg).toMatchObject(refusedAs('crm'));
    expect(otherPlaybook).toMatchObject(refusedAs('sales'));
    expect([...graph.seen(), ...others.seen()]).toEqual([]);
  });
});

describe('search over MCP', () => {
  it('is a read-only tool of the playbook that finds the same, led by plain words', async () => {
    const { server } = await serving();

    const { tools, found } = await onPlaybook(server, 'alpha', async (session) => ({
      tools: await session.listTools(),
      found: await session.callTool('search', {}),
    }));

    expect(listedTools(tools).find(({ name }) => name === 'search')?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(found.structuredContent).toEqual(foundForAlpha);
    expect(plainTextIn(found)).toBe(foundInWords);
    expect(internalTermsIn(plainTextIn(found))).toEqual([]);
  });

  it('answers a playbook the org does not have as not_found', async () => {
    const { server } = await serving();

    const missing = await onPlaybook(server, 'nowhere', (session) => session.callTool('search', {}));

    expect({ isError: missing.isError, problem: problemIn(missing) }).toMatchObject({
      isError: true,
      problem: { reason: 'not_found' },
    });
  });
});

const graphInTheOrg = { ...graphOfAlpha, playbooks: ['*'] };

const wikiInTheOrg = { ...wikiOfAlpha, playbooks: ['alpha'] };

const salesInTheOrg = { name: 'sales', type: 'mcp', playbooks: ['sales'] };

describe('search of the org over HTTP', () => {
  it('searches every server of the org with the playbooks it serves, or those that serve the playbook asked for', async () => {
    const { server } = await serving();

    const found = await server.call('GET', '/v1/orgs/acme/tool-servers/search');
    const forAlpha = await server.call('GET', '/v1/orgs/acme/tool-servers/search?playbook=alpha');

    expect(found).toMatchObject({ status: 200, body: { servers: [graphInTheOrg, salesInTheOrg, wikiInTheOrg] } });
    expect(forAlpha).toMatchObject({ status: 200, body: { servers: [graphInTheOrg, wikiInTheOrg] } });
  });
});

describe('search on the org endpoint, without a playbook and with one', () => {
  it('answers for the org and for the playbook', async () => {
    const { server } = await serving();

    const { inOrg, inAlpha } = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/mcp`, headers: {} },
      async (session) => ({
        inOrg: await session.callTool('search', {}),
        inAlpha: await session.callTool('search', { playbook: 'alpha' }),
      }),
    );

    expect(inOrg.structuredContent).toMatchObject({ servers: [graphInTheOrg, salesInTheOrg, wikiInTheOrg] });
    expect(inAlpha.structuredContent).toEqual({
      ...foundForAlpha,
      servers: [graphInTheOrg, wikiInTheOrg],
      providers: offeredByTheServer,
    });
    expect(plainTextIn(inAlpha)).toBe(foundInWords);
    expect(plainTextIn(inOrg)).toMatch(
      /^The playbooks of this org may use 3 tool servers\. “graph”, for every playbook, offers 2 tools: search and echo\./u,
    );
  });
});
