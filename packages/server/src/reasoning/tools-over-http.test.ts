import { Buffer } from 'node:buffer';

import { TimedOut } from '@on.auto/reasoning';
import {
  answers,
  callingTools,
  type ScriptedReplies,
  type ScriptedReply,
  textResult,
} from '@on.auto/reasoning/testing';
import {
  type FakeMcpServer,
  fakeStdioServerPath,
  serveFakeApi,
  serveFakeMcp,
} from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { release } from '../composition/release.ts';
import {
  alpha,
  type ReasoningServer,
  servingReasoning,
  documentsReadInProcess,
} from '../testing/servers/reasoning-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const pin = '73914286';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const closing: (() => Promise<void>)[] = [];

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

/** The stdio tool server is a process the server starts, so only the case about such a process configures one. */
const aProcessTheServerStarts = {
  limitless: {
    command: process.execPath,
    args: [fakeStdioServerPath()],
    env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
    org: 'acme',
  },
};

function serving(fake: FakeMcpServer, ...replies: readonly ScriptedReplies[]): Promise<ReasoningServer> {
  return servingWith({}, fake, replies);
}

async function servingWith(
  processes: Readonly<Record<string, unknown>>,
  fake: FakeMcpServer,
  replies: readonly ScriptedReplies[],
): Promise<ReasoningServer> {
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
      ...processes,
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'graph', source: reasoningFunction('graph/search'), diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'limitless', source: reasoningFunction('limitless/*'), diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'echo', source: reasoningFunction('graph/echo'), diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'crm', source: reasoningFunction('crm/search'), diagram: 'none' },
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

const decodeIds = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ id: Schema.String })) }),
);

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
    ),
  }),
);

const decodeKeptAnswer = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      result: Schema.Struct({
        content: Schema.Tuple([Schema.Struct({ type: Schema.Literal('image'), asset: Schema.String }), Schema.Unknown]),
      }),
    }),
  }),
);

const decodeAsset = Schema.decodeUnknownSync(
  Schema.Struct({ media_type: Schema.String, model: Schema.NullOr(Schema.String), address: Schema.String }),
);

async function servingThePhoto(recordContent: boolean): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const photographed = callingTools([['graph__photo', {}]], answers(textResult('A pixel.')));
  const server = await servingReasoning([photographed], {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        org: 'acme',
        record_content: recordContent,
      },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const sourceToolImages = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/photo]', '---', 'Look.'].join(
    '\n',
  );
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'look', source: sourceToolImages, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning/look/run`, { body: { input: {}, run_id: runId } });
  return server;
}

async function eventsOfType(server: ReasoningServer, type: string) {
  return decodeEvents((await server.call('GET', `${alpha}/events?type=${type}`)).body).events;
}

const apiKeyToolsSeveralOrgs = 'billing-api-key-5c2e8d1f';

const searchedToolsSeveralOrgs = () =>
  callingTools([['billing__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.')));

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [billing/search]', '---', 'Count acme.'].join(
  '\n',
);

async function servingOrgs() {
  const billing = await serveFakeApi({ key: apiKeyToolsSeveralOrgs });
  onTestFinished(billing.close);
  const server = await servingReasoning(
    [searchedToolsSeveralOrgs(), searchedToolsSeveralOrgs()],
    {
      BILLING_KEY: apiKeyToolsSeveralOrgs,
      TOOL_SERVERS: JSON.stringify({
        billing: { document: billing.documentUrl, security: { apiKeyAuth: '${BILLING_KEY}' }, org: ['acme', 'globex'] },
      }),
    },
    undefined,
    { documents: documentsReadInProcess },
  );
  onTestFinished(server.stop);
  await Promise.all(
    ['acme', 'globex', 'initech'].map(async (org) => {
      await server.call('POST', `/v1/orgs/${org}/playbooks`, { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `/v1/orgs/${org}/playbooks/alpha/definitions/reasoning`, {
        body: { name: 'count', source, diagram: 'none' },
      });
    }),
  );
  const run = (org: string) =>
    server.call('POST', `/v1/orgs/${org}/playbooks/alpha/definitions/reasoning/count/run`, { body: { input: {} } });
  return { billing, run };
}

const decodeHistoryToolsTwoKinds = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ type: Schema.String, data: Schema.Struct({ server: Schema.optionalKey(Schema.String) }) }),
    ),
  }),
);

const searchedBoth = callingTools(
  [
    ['graph__search', { query: 'acme' }],
    ['billing__search', { query: 'acme' }],
  ],
  answers(textResult('Acme has 2 rows in the graph and 2 in billing.')),
);

async function servingBoth() {
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const billing = await serveFakeApi({ key: apiKey });
  onTestFinished(billing.close);
  const server = await servingReasoning(
    [searchedBoth],
    {
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
        billing: { document: billing.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' },
      }),
    },
    undefined,
    { documents: documentsReadInProcess },
  );
  onTestFinished(server.stop);
  const sourceToolsTwoKinds = [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    'tools: [graph/search, billing/search]',
    '---',
    'Count acme.',
  ];
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'count', source: sourceToolsTwoKinds.join('\n'), diagram: 'none' },
  });
  return { graph, billing, server };
}

describe('tools over http', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a reasoning function that calls tools, over HTTP', () => {
    it('runs with a tool of a remote server it connects to as its release, and its history shows the call', async () => {
      const fake = await fakeGraph();
      const server = await serving(fake, searched('graph'));
      const before = { ended: fake.endedSessions(), seen: fake.seen().length };

      expect(await running(server, 'graph')).toMatchObject({
        status: 200,
        body: { status: 'succeeded', output: 'Acme has 2 rows.' },
      });
      expect(await historyOf(server)).toEqual(toolRun);
      expect(fake.received()).toEqual([
        { tool: 'search', arguments: { query: 'acme' }, meta: { 'auto.on/run_id': runId } },
      ]);
      expect(fake.endedSessions() - before.ended).toBe(1);
      expect(
        fake
          .seen()
          .slice(before.seen)
          .filter(({ rpc }) => rpc === 'initialize')
          .map(({ clientInfo }) => clientInfo),
      ).toEqual([release]);
    });

    it('runs with a tool of a process the server starts', async () => {
      const server = await servingWith(aProcessTheServerStarts, await fakeGraph(), [searched('limitless')]);

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
      const seenBefore = fake.seen().length;

      const refused = await running(server, 'crm');

      expect(refused).toMatchObject({
        status: 503,
        body: { reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_server_not_configured' },
      });
      expect(refused.headers.get('retry-after')).toBeNull();
      expect(fake.seen().slice(seenBefore)).toEqual([]);
      expect(server.modelCalls()).toBe(0);
    });
  });

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
});

describe('an image a tool answered a run, over HTTP', () => {
  it('is kept as an asset of the run, which the answer the run recorded names and get_asset reads at an address of its bytes', async () => {
    const server = await servingThePhoto(true);
    const history = decodeEvents((await server.call('GET', `${alpha}/runs/${runId}/history`)).body).events;
    const answered = history.find(({ type }) => type === 'tool_call_answered');

    const kept = decodeKeptAnswer((await server.call('GET', `${alpha}/events/${String(answered?.id)}`)).body);
    const [image] = kept.data.result.content;
    const asset = decodeAsset((await server.call('GET', `${alpha}/assets/${image.asset}`)).body);
    const bytes = await fetch(asset.address).then(async (answer) => Buffer.from(await answer.arrayBuffer()));

    expect(asset).toMatchObject({ media_type: 'image/png', model: null });
    expect(bytes.toString('base64')).toBe(pixel);
    expect(await eventsOfType(server, 'asset_kept')).toMatchObject([
      { data: { kind: 'image', made_by: { tool_call: { server: 'graph', tool: 'photo' } } } },
    ]);
  });

  it('is not kept where the server keeps no content', async () => {
    const server = await servingThePhoto(false);

    expect(await eventsOfType(server, 'asset_kept')).toEqual([]);
  });
});

describe('a tool server that serves several orgs', () => {
  it('is one entry the functions of each org call under one name and one key, and an org it does not list is refused', async () => {
    const { billing, run } = await servingOrgs();

    const ran = [await run('acme'), await run('globex'), await run('initech')];

    expect(ran.map(({ status }) => status)).toEqual([200, 200, 503]);
    expect(ran.slice(0, 2).map(({ body }) => body)).toMatchObject([
      { status: 'succeeded', output: 'Acme has 2 rows.' },
      { status: 'succeeded', output: 'Acme has 2 rows.' },
    ]);
    expect(ran[2]?.body).toMatchObject({ kind: 'tool_not_offered', because: 'tool_server_not_configured' });
    expect(billing.seen().map(({ path, headers }) => [path, headers['x-api-key']])).toEqual([
      ['/v1/search', apiKeyToolsSeveralOrgs],
      ['/v1/search', apiKeyToolsSeveralOrgs],
    ]);
  });
});

describe('a reasoning function that names a tool of an MCP server and a tool of an HTTP API', () => {
  it('calls both in one run, each the same way, and its history records both calls', async () => {
    const { graph, billing, server } = await servingBoth();

    const run = await server.call('POST', `${alpha}/definitions/reasoning/count/run`, {
      body: { input: {}, run_id: runId },
    });
    const history = decodeHistoryToolsTwoKinds((await server.call('GET', `${alpha}/runs/${runId}/history`)).body);

    expect(run).toMatchObject({
      status: 200,
      body: { status: 'succeeded', output: 'Acme has 2 rows in the graph and 2 in billing.' },
    });
    const types = history.events.map(({ type }) => type);
    const calls = history.events.slice(3, -3);
    expect([...types.slice(0, 3), ...types.slice(-3)]).toEqual([
      'run_started',
      'model_call_started',
      'model_call_answered',
      'model_call_started',
      'model_call_answered',
      'run_succeeded',
    ]);
    expect(calls.map(({ type }) => type).toSorted()).toEqual([
      'tool_call_answered',
      'tool_call_answered',
      'tool_call_started',
      'tool_call_started',
    ]);
    expect(calls.map(({ data }) => data.server)).toEqual(expect.arrayContaining(['billing', 'graph', undefined]));
    expect(graph.received()).toEqual([
      { tool: 'search', arguments: { query: 'acme' }, meta: { 'auto.on/run_id': runId } },
    ]);
    expect(billing.seen()).toMatchObject([{ method: 'GET', path: '/v1/search', query: '?query=acme' }]);
  });
});
