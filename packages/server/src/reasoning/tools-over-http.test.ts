import { TimedOut } from '@on.auto/reasoning';
import {
  answers,
  callingTools,
  textResult,
  type ScriptedReplies,
  type ScriptedReply,
} from '@on.auto/reasoning/testing';
import { fakeStdioServerPath, serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { release } from '../composition/release.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const pin = '73914286';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

function reasoningFunction(...tools: readonly string[]): string {
  return ['---', 'model: anthropic/claude-sonnet-4-5', `tools: [${tools.join(', ')}]`, '---', 'Summarize acme.'].join(
    '\n',
  );
}

async function fakeGraph(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

async function serving(fake: FakeMcpServer, ...replies: readonly ScriptedReplies[]): Promise<ReasoningServer> {
  const server = await servingReasoning(replies, {
    GRAPH_API_KEY: apiKey,
    GRAPH_PIN: pin,
    NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] ?? '',
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: fake.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Pin': '${GRAPH_PIN}' },
        org: 'acme',
      },
      crm: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'globex' },
      limitless: {
        command: process.execPath,
        args: [fakeStdioServerPath()],
        env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
        org: 'acme',
      },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'graph', source: reasoningFunction('graph/search') },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'limitless', source: reasoningFunction('limitless/*') },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'echo', source: reasoningFunction('graph/echo') },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'crm', source: reasoningFunction('crm/search') },
  });
  return server;
}

function running(server: ReasoningServer, name: string) {
  return server.call('POST', `${alpha}/definitions/reasoning/${name}/run`, {
    body: { input: {}, run_id: runId },
  });
}

async function historyOf(server: ReasoningServer): Promise<readonly string[]> {
  const read = await server.call('GET', `${alpha}/runs/${runId}/history`);
  return decodeHistory(read.body).events.map(({ type }) => type);
}

const searched = (server: string) =>
  callingTools([[`${server}__search`, { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));

const calledTools: unknown = expect.stringMatching(
  /^The run called tools and did not succeed, so it is not run again under its id/u,
);

const toolRun = [
  'run_started',
  'model_call_started',
  'model_call_answered',
  'tool_call_started',
  'tool_call_answered',
  'model_call_started',
  'model_call_answered',
  'run_succeeded',
];

describe('a reasoning function that calls tools, over HTTP', () => {
  it('runs with a tool of a remote server it connects to as its release, and its history shows the call', async () => {
    const fake = await fakeGraph();
    const server = await serving(fake, searched('graph'));

    expect(await running(server, 'graph')).toMatchObject({
      status: 200,
      body: { status: 'succeeded', output: 'Acme has 2 rows.' },
    });
    expect(await historyOf(server)).toEqual(toolRun);
    expect(fake.received()).toEqual([
      { tool: 'search', arguments: { query: 'acme' }, meta: { 'auto.on/run_id': runId } },
    ]);
    expect(fake.endedSessions()).toBe(1);
    expect(
      fake
        .seen()
        .filter(({ rpc }) => rpc === 'initialize')
        .map(({ clientInfo }) => clientInfo),
    ).toEqual([release]);
  });

  it('runs with a tool of a process the server starts', async () => {
    const server = await serving(await fakeGraph(), searched('limitless'));

    expect(await running(server, 'limitless')).toMatchObject({ status: 200, body: { output: 'Acme has 2 rows.' } });
    expect(await historyOf(server)).toEqual(toolRun);
  });
});

describe('running again a run that called tools, over HTTP', () => {
  it('answers a run that succeeded again, without calling anything', async () => {
    const fake = await fakeGraph();
    const server = await serving(fake, searched('graph'));

    const first = await running(server, 'graph');
    const again = await running(server, 'graph');

    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(fake.received()).toHaveLength(1);
    expect(server.modelCalls()).toBe(2);
  });

  it('refuses to run again under its id a run that called tools and did not succeed', async () => {
    const fake = await fakeGraph();
    const server = await serving(fake, callingTools([['graph__search', { query: 'acme' }]], timedOut));

    const first = await running(server, 'graph');
    const again = await running(server, 'graph');

    expect(first).toMatchObject({
      status: 503,
      body: {
        type: 'https://on.auto/problems/tools_unfinished',
        title: 'Tools unfinished',
        reason: 'unavailable',
        detail: 'anthropic did not answer within 60000 ms, after the run called the search tool of graph',
        kind: 'tools_unfinished',
        because: 'model_unavailable',
      },
    });
    expect(first.headers.get('retry-after')).toBeNull();
    expect(again).toMatchObject({
      status: 409,
      body: {
        type: 'https://on.auto/problems/tools_called',
        title: 'Tools called',
        reason: 'conflict',
        detail: calledTools,
        kind: 'tools_called',
      },
    });
    expect(fake.received()).toHaveLength(1);
    expect(server.modelCalls()).toBe(2);
  });
});

describe('a server bound to another org, over HTTP', () => {
  it('is not offered to the functions of this org, which reach nothing of it', async () => {
    const fake = await fakeGraph();
    const server = await serving(fake);

    const refused = await running(server, 'crm');

    expect(refused).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_server_not_configured' },
    });
    expect(refused.headers.get('retry-after')).toBeNull();
    expect(fake.seen()).toEqual([]);
    expect(server.modelCalls()).toBe(0);
  });
});

const decodeIds = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String })) }),
);

describe('the secrets of a server, over HTTP', () => {
  it('never show in the history of a run that keeps what its calls sent and received, nor in any of its events read whole, as a value, a key or a number', async () => {
    const echoed = callingTools(
      [['graph__echo', { said: `the key is ${apiKey}`, [apiKey]: 'a key', pin: Number(pin) }]],
      answers(textResult('Echoed.')),
    );
    const server = await serving(await fakeGraph(), echoed);

    await running(server, 'echo');
    const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
    const wholes = await Promise.all(
      decodeIds(history.body).events.map(async ({ id }) => (await server.call('GET', `${alpha}/events/${id}`)).body),
    );
    const seen = JSON.stringify([history.body, ...wholes]);

    expect([apiKey, pin].filter((secret) => seen.includes(secret))).toEqual([]);
    expect(seen).toContain('[redacted]');
    expect(wholes).toHaveLength(8);
  });
});

describe('a retired playbook whose functions called tools, over HTTP', () => {
  it('keeps the calls readable in the history of its runs, and runs nothing more', async () => {
    const fake = await fakeGraph();
    const server = await serving(fake, searched('graph'));
    await running(server, 'graph');
    await server.call('POST', `${alpha}/retire`);

    const again = await server.call('POST', `${alpha}/definitions/reasoning/graph/run`, { body: { input: {} } });

    expect(await historyOf(server)).toEqual(toolRun);
    expect(again).toMatchObject({ status: 409, body: { reason: 'conflict' } });
    expect(fake.received()).toHaveLength(1);
  });
});
