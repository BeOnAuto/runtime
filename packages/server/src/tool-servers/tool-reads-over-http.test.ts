import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { listedTools, withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { type FakeApiServer, type FakeMcpServer, serveFakeApi, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { release } from '../composition/release.ts';
import { askingASystem, openInput, systemRunId } from '../testing/interaction-servers/system-calls.ts';
import { configuredServer } from '../testing/processes/configured-server.ts';
import { request } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { givenGoals } from '../testing/settings/goals-kept.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const builder = createApiKey({ id: 'acme-builder', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['playbook:read'], playbooks: '*' });

const closing: (() => Promise<void>)[] = [];

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

const billingDocument = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Billing', version: '1' },
  servers: [{ url: 'https://billing.example.com' }],
  paths: {
    '/invoices': {
      get: { operationId: 'list_invoices', summary: 'Lists the invoices', responses: { '200': { description: 'ok' } } },
    },
  },
});

const refused =
  'tool_server_document_refused: The documents of the tool servers could not be read. TOOL_SERVERS: /billing/document: The document does not exist';

const search = `${alpha}/tool-servers/search?terms=invoices`;

const marks = { reads: ['echo', 'archive_note'], acts: ['search'] };

const apiKeyRuntimeUserAgent = 'billing-api-key-5c2e8d1f';

const runtime = `auto-runtime/${release.version}`;

const graphKey = 'graph-api-key-4f1d9a7c2b';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const section = 'Each section of the guide explains one step, with «quotes», a list and a table.\n';

const page = `# The guide\n\n${section.repeat(1300)}`;

const written = { path: 'docs/guide.md', branch: 'main', message: 'Update the guide', content: page };

const writtenBytes = Buffer.byteLength(JSON.stringify(written));

const EventsSchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
  ),
});

const decodeEvents = Schema.decodeUnknownSync(EventsSchema);

const decodeEvent = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
);

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface Written {
  readonly server: Pick<ReasoningServer, 'call' | 'origin'>;
  readonly fake: FakeMcpServer;
  readonly ran: unknown;
  readonly run: string;
}

async function writtenByAModel(): Promise<Written> {
  const fake = await serveFakeMcp({ bearer: graphKey });
  onTestFinished(fake.close);
  const writing = callingTools([['graph__echo', written]], answers(textResult('The guide is updated.')));
  const server = await servingReasoning([writing], {
    GRAPH_API_KEY: graphKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    'config: { max_output_tokens: 40000 }',
    'tools: [graph/echo]',
    '---',
    'Rewrite the guide and write it back.',
  ].join('\n');
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'rewrite', source, diagram: 'none' } });
  const ran = await server.call('POST', `${alpha}/definitions/reasoning/rewrite/run`, {
    body: { input: {}, run_id: runId },
  });
  return { server, fake, ran: ran.body, run: runId };
}

async function writtenByACallBlock(): Promise<Written> {
  const server = await askingASystem();
  await server.define('write-page', {
    tool: 'echo',
    read: '/path',
    with: [
      "    path: '{{ input.path }}'",
      "    branch: '{{ input.branch }}'",
      "    message: '{{ input.message }}'",
      "    content: '{{ input.content }}'",
    ],
    input: openInput,
    output: ['output:', '  schema: { type: string }'],
  });
  const ran = await server.runCall('write-page', written);
  return { server, fake: server.fake, ran: ran.body, run: systemRunId };
}

async function startOf({ server, run }: Written) {
  const history = await server.call('GET', `${alpha}/runs/${run}/history`);
  const started = decodeEvents(history.body).events.find(({ type }) => type === 'tool_call_started');
  const whole = decodeEvent((await server.call('GET', `${alpha}/events/${String(started?.id)}`)).body);
  const overMcp = await withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    (session) => session.callTool('get_event', { event_id: String(started?.id) }),
  );
  return { onThePage: started?.data, whole: whole.data, overMcp: decodeEvent(overMcp.structuredContent).data };
}

interface Writer {
  readonly by: string;
  readonly writing: () => Promise<Written>;
  readonly output: string;
}

const writers: readonly Writer[] = [
  {
    by: 'a reasoning function whose model asks for the call',
    writing: writtenByAModel,
    output: 'The guide is updated.',
  },
  {
    by: 'an interaction function whose call block renders the input into with',
    writing: writtenByACallBlock,
    output: 'docs/guide.md',
  },
];

const mebibyte = 1_048_576;

const reference = 'docs/reference.md';

function pageWithin(bytes: number, copies: number): string {
  const sentEnvelope = JSON.stringify({ path: reference, content: '' }).length;
  const inputEnvelope = JSON.stringify({ path: reference, page: '' }).length;
  return 'x'.repeat(Math.min(Math.floor((bytes - sentEnvelope) / copies), mebibyte - inputEnvelope));
}

async function renderedAndWritten(bytes: number, copies: number) {
  const filling = pageWithin(bytes, copies);
  const server = await askingASystem({ serverTakes: 16 * mebibyte });
  await server.define('write-reference', {
    tool: 'echo',
    read: '/path',
    with: ["    path: '{{ input.path }}'", `    content: '${'{{ input.page }}'.repeat(copies)}'`],
    input: openInput,
    output: ['output:', '  schema: { type: string }'],
  });
  const ran = await server.runCall('write-reference', { path: reference, page: filling });
  const sent = { path: reference, content: filling.repeat(copies) };
  const started = (await server.history(systemRunId)).find(({ type }) => type === 'tool_call_started');
  return { ran: ran.body, received: server.fake.received(), sent, started: started?.data };
}

describe('tool reads over http', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('introspect over HTTP', () => {
    it('describes a tool of an MCP server and an operation of an HTTP API to a key that may only read, and calls neither', async () => {
      const { server, graph, billing } = await serving();

      const fromTheServer = await server.call('GET', toolPath('graph', 'search'), { key: reader.key });
      const fromTheApi = await server.call('GET', toolPath('billing', 'updateProfile'), { key: reader.key });

      expect(fromTheServer).toMatchObject({
        status: 200,
        body: {
          server: 'graph',
          tool: 'search',
          annotations: { readOnlyHint: true, openWorldHint: true },
          mark: 'reads',
          marked_by: 'server',
        },
      });
      expect(fromTheApi).toMatchObject({
        status: 200,
        body: {
          server: 'billing',
          tool: 'updateProfile',
          input_schema: { required: ['id', 'body'] },
          annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
          mark: 'acts',
          marked_by: 'method',
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
        body: { would_run: false, caller_may: false, allowed: true, mark: 'reads', arguments: { valid: true } },
      });
      expect([graph.received(), billing.seen()]).toEqual([[], []]);
    });

    it('refuse a query string beside the body, as every POST does', async () => {
      const { server } = await serving();

      const refusedToolReads = await server.call('POST', `${toolPath('graph', 'search', '/validate')}?arguments=x`, {
        key: builder.key,
        body: { arguments: { query: 'acme' } },
      });

      expect(refusedToolReads).toMatchObject({
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
      const onlyReading = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
      expect(
        Object.fromEntries(
          tools
            .filter(({ name }) => ['dry_run', 'introspect'].includes(name))
            .map(({ name, annotations }) => [name, annotations]),
        ),
      ).toEqual({
        dry_run: { title: 'Dry run a tool call', ...onlyReading },
        introspect: { title: 'Introspect a tool', ...onlyReading },
      });
    });
  });
});

describe('the document of an openapi server', () => {
  it('is read when a request first needs the tool servers; a document that cannot be read fails that request, naming its entry, and is read again on the next', async () => {
    const { child, configFile } = configuredServer(
      'tool_servers:\n  billing:\n    document: billing.json\n    org: acme\n',
      {},
    );
    const document = join(dirname(configFile), 'billing.json');
    const port = await child.port;
    await request(port, 'POST', '/v1/orgs/acme/playbooks', {
      body: { playbook: 'alpha', name: 'Alpha', goals: givenGoals },
    });

    const missing = await request(port, 'GET', search);
    writeFileSync(document, billingDocument);
    const read = await request(port, 'GET', search);
    rmSync(document);
    const kept = await request(port, 'GET', search);
    child.signal('SIGTERM');
    await child.exited;
    const incident = /urn:uuid:(?<id>[\da-f-]+)/u.exec(missing.text)?.groups?.['id'];
    const logged = child
      .output()
      .stderr.split('\n')
      .filter((line) => line.includes(refused));

    expect({
      statuses: [missing.status, read.status, kept.status],
      logged: logged.map((line) => line.includes(`"incident":"${String(incident)}"`)),
      found: [read.text.includes('"tool":"list_invoices"'), kept.text === read.text],
    }).toEqual({ statuses: [500, 200, 200], logged: [true], found: [true, true] });
  });
});

describe('marks over http', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('the marks an entry of the settings gives the tools of its server, over HTTP', () => {
    it('mark the tools they name in place of their server, and warn in the log of a name the server does not list', async () => {
      const logged = vi.spyOn(console, 'error');
      onTestFinished(() => {
        logged.mockRestore();
      });
      const graph = await serveFakeMcp({ bearer: apiKey });
      closing.push(graph.close);
      const headers = { Authorization: 'Bearer ${GRAPH_API_KEY}' };
      const server = await servingReasoning([], {
        GRAPH_API_KEY: apiKey,
        TOOL_SERVERS: JSON.stringify({
          graph: { url: graph.url, headers, org: 'acme', allowed: ['search', 'echo'], marks },
        }),
      });
      closing.push(server.stop);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

      const searched = await server.call('GET', `${alpha}/tool-servers/search`);
      const warned = logged.mock.calls
        .flat()
        .map(String)
        .filter((line) => line.includes('archive_note'));

      expect(searched.body).toMatchObject({
        tools: [
          { tool: 'search', mark: 'acts' },
          { tool: 'echo', mark: 'reads' },
        ],
      });
      expect(warned).toEqual([
        expect.stringContaining(
          '"message":"The tool server graph lists no tool archive_note, which its entry marks","level":"WARN"',
        ),
      ]);
    });
  });
});

describe('runtime user agent', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('the requests the server makes to its tool servers', () => {
    it('name the command of the runtime and its release as their User-Agent, but on the calls of an entry that writes its own', async () => {
      const billing = await serveFakeApi({ key: apiKeyRuntimeUserAgent });
      closing.push(billing.close);
      const entry = { document: billing.documentUrl, security: { apiKeyAuth: '${BILLING_KEY}' }, org: 'acme' };
      const own = { ...entry, headers: { 'User-Agent': 'operator-agent/2.0' } };
      const server = await servingReasoning([], {
        BILLING_KEY: apiKeyRuntimeUserAgent,
        TOOL_SERVERS: JSON.stringify({ billing: entry, ledger: own }),
      });
      closing.push(server.stop);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      const searchRuntimeUserAgent = { body: { arguments: { query: 'acme' } } };

      const called = [
        await server.call('POST', `${alpha}/tool-servers/billing/tools/search/execute`, searchRuntimeUserAgent),
        await server.call('POST', `${alpha}/tool-servers/ledger/tools/search/execute`, searchRuntimeUserAgent),
      ];

      expect(called.map(({ status }) => status)).toEqual([200, 200]);
      expect(billing.heard().map(({ path, userAgent }) => [path, userAgent])).toEqual([
        ['/openapi.json', runtime],
        ['/openapi.json', runtime],
        ['/v1/search?query=acme', runtime],
        ['/v1/search?query=acme', 'operator-agent/2.0'],
      ]);
    });
  });
});

describe.each(writers)('a page of more than 100 KiB written to a tool by $by', ({ writing: writtenBy, output }) => {
  it('reaches the tool whole, is kept by its digest, shows its size in the run history and is read whole from get_event over HTTP', async () => {
    const writing = await writtenBy();

    const { onThePage, whole, overMcp } = await startOf(writing);

    expect(writtenBytes).toBeGreaterThan(100 * 1024);
    expect(writing.ran).toMatchObject({ status: 'succeeded', output });
    expect(writing.fake.received()).toMatchObject([{ tool: 'echo', arguments: written }]);
    expect(onThePage).toMatchObject({
      arguments_bytes: writtenBytes,
      arguments_sha256: digestOf(JSON.stringify(written)),
    });
    expect(onThePage).not.toHaveProperty('arguments');
    expect(whole['arguments']).toEqual(written);
    expect(overMcp).toMatchObject({ arguments_bytes: writtenBytes });
    expect(overMcp).not.toHaveProperty('arguments');
  });
});

describe.each([
  ['357 KiB, the page that 256 KiB refused', 357 * 1024, 1],
  ['1 MiB', mebibyte, 1],
  ['4 MiB', 4 * mebibyte, 4],
  ['8 MiB', 8 * mebibyte, 8],
])('a call block whose arguments render %s from an input of at most 1 MiB', (_size, bytes, copies) => {
  it('sends them whole within the 16 MiB a runtime sends unless set, and records their size and digest', async () => {
    const { ran, received, sent, started } = await renderedAndWritten(bytes, copies);
    const sentBytes = Buffer.byteLength(JSON.stringify(sent));

    expect(sentBytes).toBeLessThanOrEqual(bytes);
    expect(sentBytes).toBeGreaterThan(bytes - 1024);
    expect(ran).toMatchObject({ status: 'succeeded', output: reference });
    expect(received).toMatchObject([{ tool: 'echo', arguments: sent }]);
    expect(started).toMatchObject({ arguments_bytes: sentBytes, arguments_sha256: digestOf(JSON.stringify(sent)) });
  });
});
