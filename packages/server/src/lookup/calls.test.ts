import { plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { lookupDocument } from '@on.auto/lookup/testing';
import { serveFakeApi } from '@on.auto/tool-servers/served-fakes';
import { threadReplies } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { chatKey } from '../testing/interaction-servers/chat-deliveries.ts';
import { interactionServerOn } from '../testing/interaction-servers/interaction-server.ts';
import {
  type HistoryEvent,
  lookingUp,
  openInput,
  systemRunId,
  threadInput,
} from '../testing/interaction-servers/system-calls.ts';
import { withoutStudioLink } from '../testing/servers/http-client.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const aNumber: unknown = expect.any(Number);

const aTime: unknown = expect.any(String);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const scrubbedChannel: unknown = expect.stringMatching(/^\[redacted\] x{5000}$/u);

const record = { server: 'chat', tool: 'thread', read: '/messages' };

function keysOf(event: HistoryEvent | undefined): readonly string[] {
  return Object.keys(event?.data ?? {});
}

const apiKey = 'billing-api-key-5c2e8d1f';

const nameOutput: readonly string[] = ['output:', '  schema: { type: string }'];

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) })),
  }),
);

async function askingAnApi() {
  const billing = await serveFakeApi({ key: apiKey, requestIdHeader: 'x-request-id' });
  onTestFinished(billing.close);
  const entry = { document: billing.documentUrl, security: { apiKeyAuth: '${BILLING_KEY}' }, org: 'acme' };
  const server = await interactionServerOn({
    BILLING_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({ billing: { ...entry, request_id: 'x-request-id' } }),
  });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = lookupDocument({
    server: 'billing',
    tool: 'get_profiles_id',
    with: ["    id: '{{ input.id }}'"],
    read: '/name',
    input: openInput,
    output: nameOutput,
  });
  await server.call('POST', `${alpha}/definitions/lookup`, {
    body: { name: 'profile-name', source, diagram: 'none' },
  });
  return { billing, server };
}

const thread = 'thread-replies';

describe('a lookup function, over HTTP', () => {
  it('calls the tool once and answers at once with what it read, as get_run answers the run', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');

    const ran = await server.runCall('thread-replies');
    const read = await server.call('GET', `${alpha}/runs/${systemRunId}`);

    expect(ran).toMatchObject({
      status: 200,
      body: {
        run_id: systemRunId,
        type: 'lookup',
        name: 'thread-replies',
        status: 'succeeded',
        output: threadReplies,
        record,
        started_at: aTime,
        finished_at: aTime,
      },
    });
    expect(read.body).toEqual(withoutStudioLink(ran.body));
    expect(server.fake.received()).toEqual([
      {
        tool: 'thread',
        arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
        meta: { 'auto.on/run_id': systemRunId },
      },
    ]);
  });
});

describe('a lookup function saved over HTTP', () => {
  it('is refused at its call when the server marks its tool acts, and saved again once the tool reads', async () => {
    const server = await lookingUp({ hints: { thread: { readOnlyHint: false } } });

    const refused = await server.define('thread-replies');
    server.fake.annotateTool('thread', { readOnlyHint: true });
    const saved = await server.define('thread-replies');

    expect(refused).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        detail: 'The lookup function definition has a problem',
        errors: [
          {
            pointer: '/source',
            detail:
              "Line 4, /call: The thread tool of chat is marked acts, and a lookup function calls only a tool marked reads: use an interaction function, or ask the server's author to mark it read-only; whoever runs this server may also mark it reads, in the marks of its entry in tool_servers.",
          },
        ],
      },
    });
    expect(saved).toMatchObject({ status: 201, body: { type: 'lookup', name: 'thread-replies', version: 1 } });
  });

  it('is unavailable, naming its server, when the server cannot be asked for its tools', async () => {
    const server = await lookingUp();
    await server.fake.close();
    const savedAgainLater: unknown = expect.stringContaining('save it again once chat can be asked');

    expect(await server.define('thread-replies')).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', detail: savedAgainLater },
    });
  });
});

describe('the history of a run of a lookup function', () => {
  it('records the call on the run, its start under the id of the run, in the words of the history, with what it sent and what it read', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    await server.runCall('thread-replies');

    const history = await server.history(systemRunId);

    expect(history.map(({ type, summary }) => [type, summary])).toEqual([
      ['run_started', 'A run of the lookup function “thread-replies” started.'],
      ['tool_call_started', 'A run made tool call 1, to the thread tool of chat.'],
      ['tool_call_answered', 'Tool call 1 answered.'],
      ['run_succeeded', 'A run finished.'],
    ]);
    expect(history[1]?.data).toMatchObject({
      call_id: systemRunId,
      server: 'chat',
      tool: 'thread',
      arguments_sha256: aDigest,
      arguments: { channel: 'C0123', ts: '1728379900.000050', limit: 100, inclusive: false },
    });
    expect(history[2]?.data).toMatchObject({ is_error: false, duration_ms: aNumber, result_sha256: aDigest });
    expect(keysOf(history[2])).toContain('answer');
  });

  it('keeps the arguments scrubbed, shows their size past 2 KiB, and reads them whole as one event', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    await server.runCall('thread-replies', { ...threadInput, channel: `${chatKey} ${'x'.repeat(5000)}` });

    const [, started] = await server.history(systemRunId);
    const whole = await server.call('GET', `${alpha}/events/${String(started?.id)}`);

    expect(keysOf(started)).not.toContain('arguments');
    expect(started?.data['arguments_bytes']).toBeGreaterThan(5000);
    expect(whole.body).toMatchObject({ data: { arguments: { channel: scrubbedChannel } } });
  });
});

describe('a lookup function that reads through an HTTP API', () => {
  it('is saved for an operation reached by GET, calls it once with the key of its entry, answers what it read, and records the call', async () => {
    const { billing, server } = await askingAnApi();

    const ran = await server.call('POST', `${alpha}/definitions/lookup/profile-name/run`, {
      body: { input: { id: 'ada' }, run_id: systemRunId },
    });
    const { events } = decodeHistory((await server.call('GET', `${alpha}/runs/${systemRunId}/history`)).body);

    expect(ran).toMatchObject({ status: 200, body: { status: 'succeeded', output: 'Ada' } });
    expect(billing.seen()).toMatchObject([
      { method: 'GET', path: '/v1/profiles/ada', query: '', headers: { 'x-api-key': apiKey } },
    ]);
    expect(events.map(({ type }) => type)).toEqual([
      'run_started',
      'tool_call_started',
      'tool_call_answered',
      'run_succeeded',
    ]);
    expect(events[1]?.data).toMatchObject({ server: 'billing', tool: 'get_profiles_id' });
    expect(events[2]?.data).toMatchObject({ jsonrpc_id: null, server_request_id: 'request-1' });
  });
});

describe('a lookup function over MCP', () => {
  it('is created, run and its run read on the endpoint of its playbook', async () => {
    const server = await lookingUp();

    const said = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => {
        const created = await session.callTool('create_definition', {
          type: 'lookup',
          name: thread,
          source: lookupDocument(),
          diagram: 'none',
        });
        const ran = await session.callTool('run_definition', {
          type: 'lookup',
          name: thread,
          input: threadInput,
          run_id: systemRunId,
        });
        const read = await session.callTool('get_run', { run_id: systemRunId });
        return { created, ran, read };
      },
    );

    expect(said.created.structuredContent).toMatchObject({ type: 'lookup', name: thread, version: 1 });
    expect(said.ran.structuredContent).toMatchObject({ type: 'lookup', status: 'succeeded', output: threadReplies });
    expect(said.read.structuredContent).toMatchObject({
      run_id: systemRunId,
      type: 'lookup',
      name: thread,
      status: 'succeeded',
      record: { server: 'chat', tool: 'thread', read: '/messages' },
    });
    expect(plainTextIn(said.created)).toContain('lookup function');
    expect(server.fake.received()).toHaveLength(1);
  });
});
