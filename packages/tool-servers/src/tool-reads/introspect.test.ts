import { afterEach, describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import {
  describedAccess,
  playbookToolCalls,
  reportingAccess,
  serveFakeApi,
  serveFakeMcp,
  toolReader,
  type FakeMcpServer,
} from '../testing/index.ts';

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

function remote(fake: FakeMcpServer, entry: Readonly<Record<string, unknown>> = {}) {
  return { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry };
}

function callsOn(servers: Readonly<Record<string, unknown>>, fetch?: typeof globalThis.fetch) {
  const { access } = reportingAccess(servers, {
    environment: { GRAPH_API_KEY: apiKey },
    ...(fetch === undefined ? {} : { fetch }),
  });
  closing.push(access.close);
  return playbookToolCalls(access);
}

const queried = {
  type: 'object',
  properties: { query: { type: 'string', description: 'What to look for' } },
  required: ['query'],
};

describe('introspect', () => {
  it('is a query of the playbook at GET /tool-servers/{server}/tools/{tool} that reaches the servers outside', async () => {
    const { registrations } = callsOn({ graph: remote(await fakeServer()) });

    expect(registrations.introspect).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      name: 'introspect',
      route: { method: 'GET', path: '/tool-servers/{server}/tools/{tool}' },
      pathParameters: ['server', 'tool'],
      permissions: ['playbook:read'],
      reachesOutside: true,
      reasons: ['unavailable'],
    });
  });
});

describe('introspect of a tool of an MCP server', () => {
  it('describes a tool whole, with the hints its server gives it or none, to a key that may only read, and calls nothing', async () => {
    const fake = await fakeServer();
    const { call } = callsOn({ graph: remote(fake) });

    expect([
      await call('introspect', { server: 'graph', tool: 'search' }, { caller: toolReader }),
      await call('introspect', { server: 'graph', tool: 'echo' }),
    ]).toEqual([
      {
        status: 'succeeded',
        output: {
          server: 'graph',
          tool: 'search',
          description: 'Finds the rows of the graph that match a query.',
          input_schema: queried,
          annotations: { readOnlyHint: true, openWorldHint: true },
        },
      },
      {
        status: 'succeeded',
        output: {
          server: 'graph',
          tool: 'echo',
          description: 'Answers with its arguments.',
          input_schema: { type: 'object', properties: {}, required: [] },
        },
      },
    ]);
    expect(fake.received()).toEqual([]);
  });
});

describe('introspect of an operation of an HTTP API', () => {
  it('describes an operation of an HTTP API as the tool its document gives, and asks the API nothing', async () => {
    const fake = await serveFakeApi({ key: apiKey });
    closing.push(fake.close);
    const { access } = await describedAccess(
      { graph: { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: apiKey } },
    );
    closing.push(access.close);

    const described = await playbookToolCalls(access).call('introspect', { server: 'graph', tool: 'get_profiles_id' });

    expect(described).toMatchObject({
      status: 'succeeded',
      output: {
        description: 'Reads a profile.\n\nThe profile of one person, with the rows they own.',
        input_schema: {
          properties: { id: { type: 'string', description: 'The id of the profile' } },
          required: ['id'],
        },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
    });
    expect(fake.seen()).toEqual([]);
  });
});

describe('introspect refusing', () => {
  it('refuses a server not set up for the playbook and a tool its entry does not allow before any client opens', async () => {
    const fake = await fakeServer();
    const { call } = callsOn({ graph: remote(fake, { allowed: ['echo'] }), crm: remote(fake, { org: 'globex' }) });

    expect([
      await call('introspect', { server: 'crm', tool: 'search' }),
      await call('introspect', { server: 'graph', tool: 'search' }),
    ]).toMatchObject([
      {
        reason: 'unavailable',
        kind: 'tool_not_offered',
        because: 'tool_server_not_configured',
        detail: 'No tool server named crm is configured for this playbook',
      },
      {
        reason: 'unavailable',
        kind: 'tool_not_offered',
        because: 'tool_not_allowed',
        detail: 'The operator of this server does not allow graph/search',
      },
    ]);
    expect(fake.seen()).toEqual([]);
  });
});

describe('introspect refusing what it cannot reach', () => {
  it('refuses a tool its server does not list, and lets the session go', async () => {
    const fake = await fakeServer();
    const { call } = callsOn({ graph: remote(fake) });

    expect(await call('introspect', { server: 'graph', tool: 'lookup' })).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_not_offered',
      because: 'tool_not_listed',
      detail: 'The tool server graph does not list the tool lookup',
    });
    expect(fake.openSessions()).toBe(0);
  });

  it('refuses a server that cannot be asked, in words cut at 1 KiB', async () => {
    const fake = await fakeServer();
    const refusal = 'The gateway refused the request. '.repeat(100);
    const { call } = callsOn({ graph: remote(fake) }, () => Promise.reject(new Error(refusal)));

    expect(await call('introspect', { server: 'graph', tool: 'search' })).toMatchObject({
      reason: 'unavailable',
      kind: 'tool_server_failed',
      because: 'failing',
      detail: `The tool server graph could not be used: ${refusal}`.slice(0, toolBounds.failureBytes),
    });
  });
});
