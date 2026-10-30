import { Effect, Fiber } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeToolNames, reportingAccess, verboseDescription, type AccessOptions } from '../testing/index.ts';
import { fakeStdioServerPath, serveFakeMcp, type FakeMcpServer } from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const alpha = { org: 'acme', playbook: 'alpha' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function fakeServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function remote(fake: FakeMcpServer, changes: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...changes };
}

function accessTo(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}) {
  const { access } = reportingAccess(servers, {
    ...options,
    environment: { GRAPH_API_KEY: apiKey, NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], ...options.environment },
  });
  closing.push(access.close);
  return access;
}

function listed(servers: Readonly<Record<string, unknown>>, options: AccessOptions = {}, named?: string) {
  return Effect.runPromise(accessTo(servers, options).listServers(alpha, named));
}

const searchTool = {
  name: 'search',
  description: 'Finds the rows of the graph that match a query.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look for' } },
    required: ['query'],
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
};

const nothingTaken = { type: 'object', properties: {}, required: [] };

const echoTool = {
  name: 'echo',
  description: 'Answers with its arguments.',
  input_schema: nothingTaken,
};

const verboseTool = {
  name: 'verbose',
  title: 'Verbose',
  description: verboseDescription.slice(0, 4096),
  input_schema: nothingTaken,
};

describe('the tool servers a playbook may use', () => {
  it('are those that serve its org and playbook, by name, each with the tools its entry allows', async () => {
    const fake = await fakeServer();
    const servers = {
      wiki: remote(fake, { allowed: ['unlisted'] }),
      notes: remote(fake),
      graph: remote(fake, { allowed: ['search', 'echo'] }),
      crm: remote(fake, { org: 'globex' }),
      sales: remote(fake, { playbooks: ['sales'] }),
      support: remote(fake, { playbooks: ['alpha', 'support'], allowed: ['profile'] }),
    };

    const listing = await listed(servers);

    expect(listing).toMatchObject([
      { name: 'graph', type: 'mcp', record_content: true, tools: [searchTool, echoTool] },
      { name: 'notes', type: 'mcp', record_content: true, tools: fakeToolNames.map((name) => ({ name })) },
      {
        name: 'support',
        type: 'mcp',
        record_content: true,
        tools: [{ name: 'profile', description: '', input_schema: nothingTaken }],
      },
      { name: 'wiki', type: 'mcp', record_content: true, tools: [] },
    ]);
  });

  it('have the descriptions of their tools cut as a run cuts them', async () => {
    const fake = await fakeServer();

    const listing = await listed({ graph: remote(fake, { allowed: ['verbose'] }) });

    expect(verboseDescription.length).toBeGreaterThan(4096);
    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        tools: [verboseTool],
      },
    ]);
  });
});

describe('the tool servers a listing asks', () => {
  it('are only the server asked for, when one is, and no other is asked', async () => {
    const fake = await fakeServer();
    const other = await fakeServer();
    const servers = { graph: remote(fake, { allowed: ['echo'] }), wiki: remote(other) };

    const listing = await listed(servers, {}, 'graph');
    const unknown = await listed(servers, {}, 'mail');

    expect(listing).toEqual([
      { name: 'graph', type: 'mcp', record_content: true, provider: null, playbooks: ['*'], tools: [echoTool] },
    ]);
    expect(unknown).toEqual([]);
    expect(other.seen()).toEqual([]);
  });

  it('say whether each keeps the content of its calls, as its entry has it and true where it is left out', async () => {
    const fake = await fakeServer();

    const listing = await listed({
      graph: remote(fake, { allowed: ['echo'] }),
      wiki: remote(fake, { allowed: ['echo'], record_content: false }),
    });

    expect(listing).toEqual([
      { name: 'graph', type: 'mcp', record_content: true, provider: null, playbooks: ['*'], tools: [echoTool] },
      { name: 'wiki', type: 'mcp', record_content: false, provider: null, playbooks: ['*'], tools: [echoTool] },
    ]);
  });

  it('are none, and no server is asked, when none serves the playbook', async () => {
    const fake = await fakeServer();

    const listing = await listed({
      crm: remote(fake, { org: 'globex' }),
      sales: remote(fake, { playbooks: ['sales'] }),
    });

    expect(listing).toEqual([]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('a tool server whose entry leaves allowed out', () => {
  it('is asked, as every server serving the playbook is, and lists every tool it has', async () => {
    const fake = await fakeServer();
    const open = await fakeServer();

    const listing = await listed({ graph: remote(fake, { allowed: ['echo'] }), open: remote(open) });

    expect(listing).toEqual([
      { name: 'graph', type: 'mcp', record_content: true, provider: null, playbooks: ['*'], tools: [echoTool] },
      {
        name: 'open',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        tools: fakeToolNames.map((name): unknown => expect.objectContaining({ name })),
      },
    ]);
    expect(open.seen().filter(({ rpc }) => rpc === 'tools/list')).toHaveLength(1);
  });
});

describe('a tool server that is a process', () => {
  it('lists the tools of the process the server starts', async () => {
    const limitless = {
      command: process.execPath,
      args: [fakeStdioServerPath()],
      env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
      org: 'acme',
      allowed: ['search'],
    };

    const listing = await listed({ limitless });

    expect(listing).toEqual([
      { name: 'limitless', type: 'stdio', record_content: true, provider: null, playbooks: ['*'], tools: [searchTool] },
    ]);
  });
});

async function sessionsEnded(fake: FakeMcpServer): Promise<number> {
  await until(() => fake.endedSessions() > 0);
  return fake.endedSessions();
}

describe('the session a listing opens', () => {
  it('is ended once the listing has its tools, five requests in all', async () => {
    const fake = await fakeServer();

    await listed({ graph: remote(fake) });

    expect(fake.seen().map(({ method, rpc = '' }) => `${method} ${rpc}`.trim())).toEqual(
      expect.arrayContaining(['POST initialize', 'POST notifications/initialized', 'GET', 'POST tools/list', 'DELETE']),
    );
    expect(fake.seen()).toHaveLength(5);
    expect(fake.openSessions()).toBe(0);
    expect(fake.endedSessions()).toBe(1);
  });

  it('is one for the listings made at once', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake) });

    await Promise.all([Effect.runPromise(access.listServers(alpha)), Effect.runPromise(access.listServers(alpha))]);

    expect(fake.seen().filter(({ rpc }) => rpc === 'initialize')).toHaveLength(1);
    expect(fake.endedSessions()).toBe(1);
  });

  it('is ended once the listing settles, when the listing is interrupted as it opens', async () => {
    const fake = await fakeServer();
    const access = accessTo({ graph: remote(fake) });

    const release = fake.holdNextOf('initialize');
    const listing = Effect.runFork(access.listServers(alpha));
    await until(() => fake.seen().some(({ rpc }) => rpc === 'initialize'));
    const interrupted = Effect.runPromise(Fiber.interrupt(listing));
    release();
    await interrupted;

    expect(await sessionsEnded(fake)).toBe(1);
    expect(fake.openSessions()).toBe(0);
  });
});

describe('the secrets of a tool server', () => {
  it('never show in a listing, even where the server repeats one in what it lists', async () => {
    const fake = await serveFakeMcp();
    closing.push(fake.close);
    const headers = { 'X-Graph-Key': '${GRAPH_KEY}', 'X-Graph-Look': '${GRAPH_LOOK}', 'X-Region': 'production-eu' };
    const environment = { GRAPH_KEY: 'rows of the graph', GRAPH_LOOK: 'What to look for' };

    const listing = await listed(
      { graph: { url: fake.url, headers, org: 'acme', allowed: ['search'] } },
      { environment },
    );
    const text = JSON.stringify(listing);

    expect(listing).toEqual([
      {
        name: 'graph',
        type: 'mcp',
        record_content: true,
        provider: null,
        playbooks: ['*'],
        tools: [
          {
            name: 'search',
            description: 'Finds the [redacted] that match a query.',
            input_schema: {
              ...searchTool.input_schema,
              properties: { query: { type: 'string', description: '[redacted]' } },
            },
            annotations: searchTool.annotations,
          },
        ],
      },
    ]);
    expect(text).not.toContain('production-eu');
    expect(text).not.toContain(fake.url);
  });
});
