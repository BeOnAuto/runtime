import { createHash } from 'node:crypto';

import { withMcpSession } from '@on.auto/api/testing';
import { answers, callingTools, textResult } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { askingASystem, openInput, systemRunId } from '../testing/interaction-servers/system-calls.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

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
