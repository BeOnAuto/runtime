import { listedTools, withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { serveFakeApi, serveFakeMcp, type FakeApiServer, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: '*' });

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Serving {
  readonly server: ReasoningServer;
  readonly graph: FakeMcpServer;
  readonly billing: FakeApiServer;
}

async function serving(): Promise<Serving> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  closing.push(graph.close);
  const billing = await serveFakeApi({ key: apiKey });
  closing.push(billing.close);
  const server = await servingReasoning([], {
    API_KEYS: JSON.stringify([builder.entry, reader.entry]),
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      billing: { document: billing.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', {
    key: builder.key,
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  return { server, graph, billing };
}

function toolPath(server: string, tool: string, operation = ''): string {
  return `${alpha}/tool-servers/${server}/tools/${tool}${operation}`;
}

describe('introspect over HTTP', () => {
  it('describes a tool of an MCP server and an operation of an HTTP API to a key that may only read, and calls neither', async () => {
    const { server, graph, billing } = await serving();

    const fromTheServer = await server.call('GET', toolPath('graph', 'search'), { key: reader.key });
    const fromTheApi = await server.call('GET', toolPath('billing', 'updateProfile'), { key: reader.key });

    expect(fromTheServer).toMatchObject({
      status: 200,
      body: { server: 'graph', tool: 'search', annotations: { readOnlyHint: true, openWorldHint: true } },
    });
    expect(fromTheApi).toMatchObject({
      status: 200,
      body: {
        server: 'billing',
        tool: 'updateProfile',
        input_schema: { required: ['id', 'body'] },
        annotations: { idempotentHint: true, openWorldHint: true },
      },
    });
    expect([graph.received(), billing.seen()]).toEqual([[], []]);
  });
});

describe('validate and dry_run over HTTP', () => {
  it('take their arguments from the JSON body of a POST, for a key that may only read, and call nothing', async () => {
    const { server, graph, billing } = await serving();
    const body = { arguments: { id: 'ada', body: { rows: 'many' } } };

    const validated = await server.call('POST', toolPath('billing', 'updateProfile', '/validate'), {
      key: reader.key,
      body,
    });
    const dryRun = await server.call('POST', toolPath('graph', 'search', '/dry-run'), {
      key: reader.key,
      body: { arguments: { query: 'acme' } },
    });

    expect(validated).toMatchObject({ status: 200, body: { valid: false, issues: [{}, {}] } });
    expect(dryRun).toMatchObject({
      status: 200,
      body: { would_run: false, caller_may: false, allowed: true, read_only: true, arguments: { valid: true } },
    });
    expect([graph.received(), billing.seen()]).toEqual([[], []]);
  });

  it('refuse a query string beside the body, as every POST does', async () => {
    const { server } = await serving();

    const refused = await server.call('POST', `${toolPath('graph', 'search', '/validate')}?arguments=x`, {
      key: builder.key,
      body: { arguments: { query: 'acme' } },
    });

    expect(refused).toMatchObject({
      status: 400,
      body: {
        reason: 'bad_request',
        detail: 'An operation called by POST or PUT takes no query parameters; send its input in the JSON body',
      },
    });
  });
});

describe('introspect and dry_run over MCP', () => {
  it('are tools that only read, dry_run though it is routed by POST, and validate is served over HTTP alone', async () => {
    const { server } = await serving();

    const tools = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: { authorization: `Bearer ${reader.key}` } },
      async (session) => listedTools(await session.listTools()),
    );

    expect(tools.filter(({ name }) => name === 'validate')).toEqual([]);
    expect(
      tools.filter(({ name }) => ['dry_run', 'introspect'].includes(name)).map(({ annotations }) => annotations),
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      })),
    );
  });
});
