import { createHash } from 'node:crypto';

import { connectMcp, plainTextIn, withMcpSession } from '@on.auto/api/testing';
import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { OutputInvalid, RateLimited } from '@on.auto/reasoning';
import {
  answers,
  callingTools,
  jsonResult,
  type ScriptedReply,
  textResult,
  toolCallsResult,
} from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { heldAnswerOn, ownClockOf } from '../testing/waiting/stepped-server-clock.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

const verdict = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

let server: ReasoningServer;

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ type: Schema.String, data: Schema.Struct({ number: Schema.optionalKey(Schema.Number) }) }),
    ),
  }),
);

function numberedIn(body: unknown): readonly (readonly [string, number | null])[] {
  return decodeHistory(body).events.map(({ type, data }) => [type, data.number ?? null]);
}

async function serving(...replies: readonly ScriptedReply[]): Promise<ReasoningServer> {
  server = await servingReasoning(replies);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summary, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'verdict', source: verdict, diagram: 'none' },
  });
  return server;
}

function running(name: string, body: object) {
  return server.call('POST', `${alpha}/definitions/reasoning/${name}/run`, { body });
}

const limited: ScriptedReply = () =>
  Effect.fail(
    new RateLimited({ detail: 'anthropic is limiting the rate', provider: 'anthropic', retry_after_ms: null }),
  );

const summaryAttemptsAtOnce = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join(
  '\n',
);

const runIdAttemptsAtOnce = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const summaryCancelledAcrossServers = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'tools: [graph/search]',
  '---',
  'Summarize acme.',
].join('\n');

const runIdCancelledAcrossServers = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

const usage = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

const decodeHistoryCancelledAcrossServers = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const neverAsked: ScriptedReply = () => Effect.succeed(textResult('Never asked.'));

async function twoServersOnOneLedger(first: readonly ScriptedReply[]) {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const environment = {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: graph.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  };
  const runningCancelledAcrossServers = await servingReasoning(first, environment, undefined, { ledger });
  onTestFinished(runningCancelledAcrossServers.stop);
  const other = await servingReasoning([], environment, undefined, { ledger });
  onTestFinished(other.stop);
  await runningCancelledAcrossServers.call('POST', '/v1/orgs/acme/playbooks', {
    body: { playbook: 'alpha', name: 'Alpha' },
  });
  await runningCancelledAcrossServers.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'summary', source: summaryCancelledAcrossServers, diagram: 'none' },
  });
  return { graph, running: runningCancelledAcrossServers, other };
}

const summaryOutlivedClient = ['---', 'model: anthropic/claude-sonnet-4-5', '---', 'Summarize: {{ input.text }}'].join(
  '\n',
);

const runIdOutlivedClient = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const asked = { input: { text: 'the quarter' }, run_id: runIdOutlivedClient };

const decodeHistoryOutlivedClient = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

/** The requests to run the summary that reached the server, answered or not. */
function runsAsked(asking: ReasoningServer): number {
  return asking.arrived().filter(({ method, path }) => method === 'POST' && path.endsWith('/summary/run')).length;
}

/** The requests the server answered after its client had gone. */
function seenGone(answering: ReasoningServer): number {
  return answering.answered().filter(({ status }) => status === 499).length;
}

/** The requests to the MCP endpoint the server has not answered yet: none once it let its client go. */
function mcpStillAnswering(answering: ReasoningServer): number {
  const arrived = answering.arrived().filter(({ path }) => path.endsWith('/mcp')).length;
  return arrived - answering.answered().filter(({ path }) => path.endsWith('/mcp')).length;
}

function givenUp(): { readonly gaveUp: Promise<unknown>; readonly giveUp: () => void } {
  const givingUp = new AbortController();
  const gaveUp: Promise<unknown> = fetch(`${server.origin}${alpha}/definitions/reasoning/summary/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(asked),
    signal: givingUp.signal,
  }).catch((error: unknown) => error);
  return {
    gaveUp,
    giveUp: () => {
      givingUp.abort();
    },
  };
}

/** A model that never answers, its call held on the server's clock, so the server can still come to rest. */
const neverAnswering: ScriptedReply = () => heldAnswerOn(ownClockOf(server));

/**
 * A model that never answers, and the promise of its call: a request an MCP client sends tells no wait before it
 * reaches the server, so the test awaits the model's own signal that the run called it.
 */
function neverAnsweringOnceCalled(): { readonly reply: ScriptedReply; readonly called: Promise<void> } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return {
    reply: () =>
      Effect.andThen(
        Effect.sync(() => {
          resolve();
        }),
        heldAnswerOn(ownClockOf(server)),
      ),
    called: promise,
  };
}

const summaryOutlivedClientOverMcp = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

const runIdOutlivedClientOverMcp = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c';

const decodeHistoryOutlivedClientOverMcp = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

const summaryRejectedRunHistory = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  'Summarize: {{ input.text }}',
].join('\n');

function usageOf(input: number, output: number) {
  return {
    input: { total: input, uncached: input, cache_read: 0, cache_write: 0 },
    output: { total: output, text: output, reasoning: null },
    total: input + output,
  };
}

const unusable = new OutputInvalid({
  detail: 'The answer is not JSON',
  provider: 'anthropic',
  finish_reason: 'stop',
  raw_finish_reason: 'end_turn',
  usage: usageOf(300, 20),
  issues: [],
});

const succeeded = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const rejected = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

const decodeRecord = Schema.decodeUnknownSync(Schema.Struct({ record: Schema.Json }));

async function recordOf(runIdRejectedRunHistory: string): Promise<Schema.Json> {
  return decodeRecord((await server.call('GET', `${alpha}/runs/${runIdRejectedRunHistory}`)).body).record;
}

function historyOf(runIdRejectedRunHistory: string): Promise<unknown> {
  return server.call('GET', `${alpha}/runs/${runIdRejectedRunHistory}/history`).then(({ body }) => body);
}

const pin = '73914286';

const sent = { said: `the key is ${apiKey}`, [apiKey]: 'a key', pin: Number(pin) };

const decodeEvents = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(
      Schema.Struct({ id: Schema.String, type: Schema.String, data: Schema.Record(Schema.String, Schema.Json) }),
    ),
  }),
);

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function servingTheEcho(recordContent: boolean): Promise<ReasoningServer> {
  const graph = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(graph.close);
  const echoed = callingTools([['graph__echo', sent]], answers(textResult('Echoed.')));
  const serverKeptDigests = await servingReasoning([echoed], {
    GRAPH_API_KEY: apiKey,
    GRAPH_PIN: pin,
    TOOL_SERVERS: JSON.stringify({
      graph: {
        url: graph.url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Pin': '${GRAPH_PIN}' },
        org: 'acme',
        record_content: recordContent,
      },
    }),
  });
  onTestFinished(serverKeptDigests.stop);
  await serverKeptDigests.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/echo]', '---', 'Echo it.'].join('\n');
  await serverKeptDigests.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'echo', source, diagram: 'none' },
  });
  await serverKeptDigests.call('POST', `${alpha}/definitions/reasoning/echo/run`, {
    body: { input: {}, run_id: runId },
  });
  return serverKeptDigests;
}

async function callEventsOf(serverKeptDigests: ReasoningServer) {
  const history = await serverKeptDigests.call('GET', `${alpha}/runs/${runId}/history`);
  const calls = decodeEvents(history.body).events.filter(({ type }) => type.startsWith('tool_call_'));
  const wholes = await Promise.all(
    calls.map(async ({ id }) => (await serverKeptDigests.call('GET', `${alpha}/events/${id}`)).body),
  );
  return { page: history.body, calls, wholes: decodeEvents({ events: wholes }).events };
}

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const globexAdmin = createApiKey({ id: 'globex-admin', org: 'globex', permissions: allPermissions, playbooks: '*' });

const summaryReasoningIsolation = '---\nmodel: anthropic/claude-sonnet-4-5\n---\nSummarize {{ input.text }}';

describe('reasoning over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('running a reasoning function definition over HTTP', () => {
    it('answers with the run and the text of the model', async () => {
      await serving(answers(textResult('Profits rose.')));

      expect(await running('summary', { input: { text: 'the quarter' } })).toMatchObject({
        status: 200,
        body: {
          type: 'reasoning',
          name: 'summary',
          definition_version: 1,
          status: 'succeeded',
          output: 'Profits rose.',
        },
      });
    });

    it('answers with the JSON value of a JSON definition', async () => {
      await serving(answers(jsonResult({ approve: true })));

      expect(await running('verdict', { input: { expense: 'a dinner' } })).toMatchObject({
        status: 200,
        body: { status: 'succeeded', output: { approve: true } },
      });
    });
  });

  describe('a run of a reasoning function that ended unavailable, over HTTP', () => {
    it('runs again under its id a run that ended unavailable, numbering its model calls after the first', async () => {
      await serving(limited, answers(textResult('Profits rose.')));
      const first = await running('summary', { input: { text: 'the quarter' }, run_id: runId });
      const again = await running('summary', { input: { text: 'the quarter' }, run_id: runId });
      const history = await server.call('GET', `${alpha}/runs/${runId}/history`);

      expect([first.status, again.status]).toEqual([503, 200]);
      expect(numberedIn(history.body)).toEqual([
        ['run_started', null],
        ['model_call_started', 1],
        ['model_call_failed', 1],
        ['run_rejected', null],
        ['run_started', null],
        ['model_call_started', 2],
        ['model_call_answered', 2],
        ['run_succeeded', null],
      ]);
    });
  });

  describe('the runs of a reasoning function definition over HTTP', () => {
    it('rejects an input that does not match the input schema with 422, under /input', async () => {
      await serving();

      expect(await running('summary', { input: { text: 7 } })).toMatchObject({
        status: 422,
        body: {
          reason: 'invalid_input',
          errors: [{ pointer: '/input/text', detail: 'text: expected text; it was given a number.' }],
        },
      });
      expect(server.modelCalls()).toBe(0);
    });

    it('answers a retry with the same run id from the record, without calling the model again', async () => {
      await serving(answers(textResult('Profits rose.')));
      const first = await running('summary', { input: { text: 'the quarter' }, run_id: runId });
      const retried = await running('summary', { input: { text: 'the quarter' }, run_id: runId });

      expect(first).toMatchObject({ status: 200, body: { run_id: runId, output: 'Profits rose.' } });
      expect(retried.body).toEqual(first.body);
      expect(server.modelCalls()).toBe(1);
    });

    it('shows the record of the run with get_run', async () => {
      await serving(answers(textResult('Profits rose.', { response_id: 'msg_01', duration_ms: 420 })));
      await running('summary', { input: { text: 'the quarter' }, run_id: runId });

      expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
        status: 200,
        body: {
          run_id: runId,
          status: 'succeeded',
          output: 'Profits rose.',
          record: {
            model: { requested: 'anthropic/claude-sonnet-4-5', resolved: 'scripted/model', answered: 'model' },
            settings: { max_output_tokens: 1024 },
            output_format: 'text',
            finish_reason: 'stop',
            response_id: 'msg_01',
            duration_ms: 420,
            prompt: { instructions: 'Be brief.', message: 'Summarize: the quarter', truncated: false },
          },
        },
      });
    });
  });
});

describe('two requests for one run at once, in one server', () => {
  it('make one attempt of it, whose answer both are given, so that a retry of a client is answered once', async () => {
    const answering = Promise.withResolvers<void>();
    const heldUntilAnswered: ScriptedReply = () =>
      Effect.promise(() => answering.promise).pipe(Effect.as(textResult('Profits rose.')));
    const serverAttemptsAtOnce = await servingReasoning([heldUntilAnswered]);
    onTestFinished(serverAttemptsAtOnce.stop);
    await serverAttemptsAtOnce.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
    await serverAttemptsAtOnce.call('POST', `${alpha}/definitions/reasoning`, {
      body: { name: 'summary', source: summaryAttemptsAtOnce, diagram: 'none' },
    });
    const request = { body: { input: { text: 'the quarter' }, run_id: runIdAttemptsAtOnce } };

    const first = serverAttemptsAtOnce.call('POST', `${alpha}/definitions/reasoning/summary/run`, request);
    await whenHeld(
      () => serverAttemptsAtOnce.modelCalls(),
      (calls) => calls > 0,
    );
    const retry = serverAttemptsAtOnce.call('POST', `${alpha}/definitions/reasoning/summary/run`, request);
    await whenHeld(
      () => runsAsked(serverAttemptsAtOnce),
      (arrived) => arrived === 2,
    );
    answering.resolve();
    const answersAttemptsAtOnce = await Promise.all([first, retry]);

    expect(answersAttemptsAtOnce.map(({ status, body }) => [status, body])).toEqual([
      [200, expect.objectContaining({ run_id: runIdAttemptsAtOnce, status: 'succeeded', output: 'Profits rose.' })],
      [200, answersAttemptsAtOnce[0]?.body],
    ]);
    expect(serverAttemptsAtOnce.modelCalls()).toBe(1);
  });
});

describe('a reasoning run cancelled through another server while its model answers', () => {
  it('starts no call after the answer, and ends cancelled with the spending of its model call', async () => {
    const answering = Promise.withResolvers<void>();
    const heldThenAsking: ScriptedReply = () =>
      Effect.promise(() => answering.promise).pipe(
        Effect.as(toolCallsResult([['graph__search', { query: 'acme' }]], { usage, duration_ms: 400 })),
      );
    const {
      graph,
      running: runningCancelledAcrossServers,
      other,
    } = await twoServersOnOneLedger([heldThenAsking, neverAsked]);

    const askedCancelledAcrossServers = runningCancelledAcrossServers.call(
      'POST',
      `${alpha}/definitions/reasoning/summary/run`,
      {
        body: { input: {}, run_id: runIdCancelledAcrossServers },
      },
    );
    await whenHeld(
      () => runningCancelledAcrossServers.modelCalls(),
      (calls) => calls > 0,
    );
    const cancelled = await other.call('POST', `${alpha}/runs/${runIdCancelledAcrossServers}/cancel`, {
      body: { reason: 'Not needed' },
    });
    answering.resolve();
    const ended = await askedCancelledAcrossServers;
    const run = await other.call('GET', `${alpha}/runs/${runIdCancelledAcrossServers}`);
    const history = await other.call('GET', `${alpha}/runs/${runIdCancelledAcrossServers}/history`);

    expect(cancelled).toMatchObject({ status: 200, body: { run_id: runIdCancelledAcrossServers, status: 'started' } });
    expect(ended).toMatchObject({
      status: 409,
      body: { reason: 'cancelled', kind: 'requested', detail: 'Not needed' },
    });
    expect(run.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested' },
      record: { usage, duration_ms: 400 },
    });
    expect(decodeHistoryCancelledAcrossServers(history.body).events.map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_cancel_requested',
      'model_call_answered',
      'run_rejected',
    ]);
    expect([runningCancelledAcrossServers.modelCalls(), graph.received()]).toEqual([1, []]);
  });
});

describe('outlived client over http', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a run whose client goes away while the model answers', () => {
    it('outlives its client: the model answers, the run records its result, and a retry is given it', async () => {
      const answering = Promise.withResolvers<void>();
      const heldUntilReleased: ScriptedReply = () =>
        Effect.promise(() => answering.promise).pipe(Effect.as(textResult('Profits rose.')));
      server = await servingReasoning([heldUntilReleased], {}, undefined, { over: 'http' });
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'summary', source: summaryOutlivedClient, diagram: 'none' },
      });

      const client = givenUp();
      await whenHeld(
        () => server.modelCalls(),
        (calls) => calls > 0,
      );
      client.giveUp();
      await whenHeld(
        () => seenGone(server),
        (gone) => gone > 0,
      );
      const whileLive = server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: asked });
      answering.resolve();
      const retried = await whileLive;
      const after = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: asked });
      const history = await server.call('GET', `${alpha}/runs/${runIdOutlivedClient}/history`);

      expect(await client.gaveUp).toMatchObject({ name: 'AbortError' });
      expect(retried).toMatchObject({
        status: 200,
        body: { run_id: runIdOutlivedClient, status: 'succeeded', output: 'Profits rose.' },
      });
      expect(after.body).toEqual(retried.body);
      expect(decodeHistoryOutlivedClient(history.body).events.map(({ type }) => type)).toEqual([
        'run_started',
        'model_call_started',
        'model_call_answered',
        'run_succeeded',
      ]);
      expect(server.modelCalls()).toBe(1);
    });
  });

  describe('a run whose client went away, cancelled while the model answers', () => {
    it('is stopped by cancel_run, its model call ended as interrupted, ends cancelled as asked, the model called once', async () => {
      server = await servingReasoning([neverAnswering]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'summary', source: summaryOutlivedClient, diagram: 'none' },
      });

      const client = givenUp();
      await whenHeld(
        () => server.modelCalls(),
        (calls) => calls > 0,
      );
      client.giveUp();
      await whenHeld(
        () => seenGone(server),
        (gone) => gone > 0,
      );
      const cancelled = await server.call('POST', `${alpha}/runs/${runIdOutlivedClient}/cancel`, {
        body: { reason: 'Not needed' },
      });
      const retried = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, { body: asked });
      const history = await server.call('GET', `${alpha}/runs/${runIdOutlivedClient}/history`);

      expect(cancelled).toMatchObject({
        status: 200,
        body: {
          run_id: runIdOutlivedClient,
          status: 'rejected',
          rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed' },
        },
      });
      expect(retried).toMatchObject({ status: 409, body: { reason: 'cancelled', kind: 'requested' } });
      expect(decodeHistoryOutlivedClient(history.body).events.map(({ type }) => type)).toEqual([
        'run_started',
        'model_call_started',
        'run_cancel_requested',
        'model_call_failed',
        'run_rejected',
      ]);
      expect(server.modelCalls()).toBe(1);
    });
  });
});

describe('outlived client over mcp', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('a reasoning run whose MCP client goes away while the model answers', () => {
    it('goes on without its client, and cancel_run over MCP stops it, its model call ended, the model called once', async () => {
      const model = neverAnsweringOnceCalled();
      server = await servingReasoning([model.reply]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'summary', source: summaryOutlivedClientOverMcp, diagram: 'none' },
      });
      const connection = { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} };
      const leaving = await connectMcp('current revision', connection);

      const leftBehind = leaving
        .callTool('run_definition', {
          type: 'reasoning',
          name: 'summary',
          input: { text: 'the quarter' },
          run_id: runIdOutlivedClientOverMcp,
        })
        .catch((error: unknown) => error);
      await model.called;
      await leaving.close();
      await leftBehind;
      await whenHeld(
        () => mcpStillAnswering(server),
        (answering) => answering === 0,
      );
      const { going, cancelled } = await withMcpSession('current revision', connection, async (session) => ({
        going: await session.callTool('get_run', { run_id: runIdOutlivedClientOverMcp }),
        cancelled: await session.callTool('cancel_run', { run_id: runIdOutlivedClientOverMcp, reason: 'Not needed' }),
      }));
      const history = await server.call('GET', `${alpha}/runs/${runIdOutlivedClientOverMcp}/history`);

      expect(going.structuredContent).toMatchObject({ run_id: runIdOutlivedClientOverMcp, status: 'started' });
      expect(cancelled.structuredContent).toMatchObject({
        run_id: runIdOutlivedClientOverMcp,
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed' },
      });
      expect(decodeHistoryOutlivedClientOverMcp(history.body).events.map(({ type }) => type)).toEqual([
        'run_started',
        'model_call_started',
        'run_cancel_requested',
        'model_call_failed',
        'run_rejected',
      ]);
      expect(server.modelCalls()).toBe(1);
    });
  });
});

describe('rejected run history', () => {
  afterEach(async () => {
    await server.stop();
  });

  describe('the history of a reasoning run rejected after its model was called', () => {
    it('shows the record the rejection kept, as the history of a run that succeeded does, over HTTP and MCP', async () => {
      server = await servingReasoning([
        answers(textResult('Profits rose.', { usage: usageOf(1200, 80) })),
        () => Effect.fail(unusable),
      ]);
      await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
      await server.call('POST', `${alpha}/definitions/reasoning`, {
        body: { name: 'summary', source: summaryRejectedRunHistory, diagram: 'none' },
      });
      const runningRejectedRunHistory = (runIdRejectedRunHistory: string, text: string) =>
        server.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
          body: { input: { text }, run_id: runIdRejectedRunHistory },
        });
      await runningRejectedRunHistory(succeeded, 'the quarter');
      const rejecting = await runningRejectedRunHistory(rejected, 'the year');

      const histories = { succeeded: await historyOf(succeeded), rejected: await historyOf(rejected) };
      const overMcp = await withMcpSession(
        'current revision',
        { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
        (session) => session.callTool('list_playbook_events', { run_id: rejected, order: 'asc' }),
      );

      expect(rejecting).toMatchObject({ status: 503, body: { reason: 'unavailable' } });
      expect(histories).toMatchObject({
        succeeded: {
          events: [
            { type: 'run_started' },
            { type: 'model_call_started', data: { number: 1 } },
            { type: 'model_call_answered', data: { number: 1, usage: usageOf(1200, 80) } },
            { type: 'run_succeeded', data: { output: 'Profits rose.', record: await recordOf(succeeded) } },
          ],
        },
        rejected: {
          events: [
            { type: 'run_started' },
            { type: 'model_call_started', data: { number: 1 } },
            { type: 'model_call_failed', data: { number: 1, because: 'output_invalid', usage: usageOf(300, 20) } },
            { type: 'run_rejected', data: { reason: 'unavailable', record: await recordOf(rejected) } },
          ],
        },
      });
      expect(overMcp.structuredContent?.['in_words']).toBe(plainTextIn(overMcp));
      expect({ ...overMcp.structuredContent, in_words: undefined }).toEqual(histories.rejected);
    });
  });
});

describe('the digests of what a call sent and received, over HTTP', () => {
  it('name the scrubbed text the playbook kept, and the key and the pin appear on no page, no event read whole and no line of the log', async () => {
    const logged = vi.spyOn(console, 'error');
    onTestFinished(() => {
      logged.mockRestore();
    });
    const serverKeptDigests = await servingTheEcho(true);

    const { page, calls, wholes } = await callEventsOf(serverKeptDigests);
    const seen = JSON.stringify([page, wholes, ...logged.mock.calls.flat().map(String)]);
    const keptTexts = [JSON.stringify(wholes[0]?.data['arguments']), JSON.stringify(wholes[1]?.data['result'])];

    expect(calls.map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
    expect(calls.map(({ data }) => [data['arguments_sha256'], data['result_sha256']])).toEqual([
      [digestOf(String(keptTexts[0])), undefined],
      [undefined, digestOf(String(keptTexts[1]))],
    ]);
    expect(keptTexts.map((text) => text.includes('[redacted]'))).toEqual([true, true]);
    expect(seen).not.toContain(apiKey);
    expect(seen).not.toContain(pin);
  });

  it('are left out of the facts of a server that keeps no content, which carry their sizes, and an event read whole joins nothing', async () => {
    const serverKeptDigests = await servingTheEcho(false);

    const { calls, wholes } = await callEventsOf(serverKeptDigests);

    expect(calls.map(({ data }) => Object.keys(data).filter((field) => /_(?:bytes|sha256)$/u.test(field)))).toEqual([
      ['arguments_bytes'],
      ['result_bytes'],
    ]);
    expect(wholes.map(({ data }) => ['arguments', 'result', 'answer'].filter((field) => field in data))).toEqual([
      [],
      [],
    ]);
  });
});

describe('reasoning isolation over http', () => {
  beforeAll(async () => {
    server = await servingReasoning([answers(textResult('Done'))], {
      API_KEYS: JSON.stringify([acmeAdmin.entry, globexAdmin.entry]),
    });
    const acme = { key: acmeAdmin.key };
    await server.call('POST', '/v1/orgs/acme/playbooks', { ...acme, body: { playbook: 'alpha', name: 'Alpha' } });
    await server.call('POST', '/v1/orgs/acme/playbooks', { ...acme, body: { playbook: 'beta', name: 'Beta' } });
    await server.call('POST', '/v1/orgs/globex/playbooks', {
      key: globexAdmin.key,
      body: { playbook: 'alpha', name: 'Globex alpha' },
    });
    await server.call('POST', '/v1/orgs/acme/playbooks/alpha/definitions/reasoning', {
      ...acme,
      body: { name: 'summary', source: summaryReasoningIsolation, diagram: 'none' },
    });
    await server.call('POST', '/v1/orgs/acme/playbooks/alpha/definitions/reasoning/summary/run', {
      ...acme,
      body: { input: { text: 'the quarter' }, run_id: runId },
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('a reasoning function definition of one playbook', () => {
    it('is invisible from another playbook of the same org', async () => {
      const beta = '/v1/orgs/acme/playbooks/beta';
      const options = { key: acmeAdmin.key };

      expect(await server.call('GET', `${beta}/definitions/reasoning`, options)).toMatchObject({
        status: 200,
        body: { definitions: [] },
      });
      expect(await server.call('GET', `${beta}/definitions/reasoning/summary`, options)).toMatchObject({
        status: 404,
        body: { reason: 'not_found' },
      });
      expect(
        await server.call('POST', `${beta}/definitions/reasoning/summary/run`, { ...options, body: { input: {} } }),
      ).toMatchObject({ status: 404 });
      expect(await server.call('GET', `${beta}/runs/${runId}`, options)).toMatchObject({ status: 404 });
    });

    it('is invisible from a playbook of the same id in another org, and forbidden to its keys', async () => {
      const globexAlpha = '/v1/orgs/globex/playbooks/alpha';
      const globex = { key: globexAdmin.key };

      expect(await server.call('GET', `${globexAlpha}/definitions/reasoning`, globex)).toMatchObject({
        status: 200,
        body: { definitions: [] },
      });
      expect(await server.call('GET', `${globexAlpha}/runs/${runId}`, globex)).toMatchObject({
        status: 404,
      });
      expect(
        await server.call('GET', '/v1/orgs/acme/playbooks/alpha/definitions/reasoning/summary', globex),
      ).toMatchObject({
        status: 403,
        body: { reason: 'forbidden' },
      });
      expect(server.modelCalls()).toBe(1);
    });
  });
});
