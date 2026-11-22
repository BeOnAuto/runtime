import { randomUUID } from 'node:crypto';

import { TimedOut } from '@on.auto/reasoning';
import {
  answers,
  callingTools,
  type ScriptedReplies,
  type ScriptedReply,
  textResult,
} from '@on.auto/reasoning/testing';
import { type FakeMcpServer, serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import type { SpawnedServer } from '../testing/processes/spawned-server.ts';
import { requestTo, settledOver, workflowProcess } from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  runIdIn,
  servingWorkflows,
  settledAsSwept,
  settledRun,
  workflowSource,
} from '../testing/servers/workflow-server.ts';
import { contributing, givenGoals } from '../testing/settings/goals-kept.ts';
import type { SteppedServerClock } from '../testing/waiting/stepped-server-clock.ts';
import { steppedServerClock } from '../testing/waiting/stepped-server-clock.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

function reasoningFunction(tool: string): string {
  return ['---', 'model: anthropic/claude-sonnet-4-5', `tools: [${tool}]`, '---', 'Find acme.'].join('\n');
}

function workflowCalling(name: string, definition: string, caught: boolean): string {
  const call = `{ call: run_definition, with: { type: reasoning, name: ${definition} } }`;
  return workflowSource(
    name,
    caught
      ? `do:
  - lookup:
      try:
        - find: ${call}
      catch:
        as: failure
        do:
          - report:
              set: '\${ { kind: $failure.kind, because: $failure.because } }'
`
      : `do:\n  - find: ${call}\n`,
  );
}

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const unfinishedWords: unknown = expect.stringMatching(
  /did not succeed, .*; the workflow ended\. It called tools but could not finish, because the model stopped answering\.$/u,
);

const decodeHistory = Schema.decodeUnknownSync(
  Schema.Struct({
    events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String, data: Schema.Unknown })),
  }),
);

const closing: (() => Promise<void>)[] = [];

async function serving(...replies: readonly ScriptedReplies[]): Promise<ReasoningServer> {
  const fake: FakeMcpServer = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const gone = await serveFakeMcp();
  await gone.close();
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } };
  const server = await servingWorkflows(replies, {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { ...graph, org: 'acme' },
      crm: { ...graph, org: 'globex' },
      down: { url: gone.url, org: 'acme' },
    }),
  });
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'graph', source: reasoningFunction('graph/search'), diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'crm', source: reasoningFunction('crm/search'), diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'reporting', source: workflowCalling('reporting', 'crm', true) },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'down', source: reasoningFunction('down/search'), diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'careless', source: workflowCalling('careless', 'graph', false) },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'stranded', source: workflowCalling('stranded', 'down', false) },
  });
  return server;
}

async function settledWorkflowRun(server: ReasoningServer, name: string) {
  const startedWorkflowTools = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, {
    body: { input: {} },
  });
  const runId = runIdIn(startedWorkflowTools.body);
  const settled = await settledRun(server, `${alpha}/runs/${runId}`);
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const { events } = decodeHistory(history.body);
  const answersWorkflowTools = events.filter(({ summary }) => summary.startsWith('A function'));
  const ending = events.find(({ type }) => type === 'run_rejected')?.summary;
  return { settled, answers: answersWorkflowTools, ending };
}

const sleeper = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/sleep]', '---', 'Wait for acme.'].join(
  '\n',
);

const impatient = workflowSource(
  'impatient',
  `do:
  - wait:
      call: run_definition
      with: { type: reasoning, name: sleeper }
      timeout: { after: PT1S }
`,
);

const aSecond = 1000;

const decodeHistoryWorkflowToolCancellation = Schema.decodeUnknownSync(
  Schema.Struct({ events: Schema.Array(Schema.Struct({ type: Schema.String })) }),
);

async function servingWorkflowToolCancellation(
  fake: FakeMcpServer,
  clock: SteppedServerClock,
): Promise<ReasoningServer> {
  const server = await servingWorkflows(
    [callingTools([['graph__sleep', { ms: 60_000 }]], answers(textResult('Slept.')))],
    {
      GRAPH_API_KEY: apiKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
    },
    undefined,
    clock,
  );
  closing.push(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'sleeper', source: sleeper, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'impatient', source: impatient } });
  return server;
}

type Seen = ReturnType<FakeMcpServer['seen']>;

function untilCancelled(fake: FakeMcpServer): Promise<Seen> {
  return whenHeld(
    (): Seen => fake.seen().filter(({ rpc }) => rpc === 'tools/call' || rpc === 'notifications/cancelled'),
    (seen) => seen.some(({ rpc }) => rpc === 'notifications/cancelled'),
  );
}

const marker = 'marker-7d1c9e';

const ledger = temporaryLedger();

interface Definition {
  readonly name: string;
  readonly steps: string;
}

const definitions: readonly Definition[] = [
  {
    name: 'document',
    steps: `do:\n  - fail: { raise: { error: { type: https://example.com/${marker}, status: 422, title: ${marker} } } }\n`,
  },
  {
    name: 'input',
    steps:
      "do:\n  - fail: { raise: { error: { type: https://example.com/no, status: 422, title: No, detail: '${ $data.secret }' } } }\n",
  },
  {
    name: 'event',
    steps: `do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.go } } } } }\n  - fail: { raise: { error: { type: https://example.com/no, status: 422, title: No, detail: '\${ $data[0].secret }' } } }\n`,
  },
  {
    name: 'nested',
    steps: `do:\n  - ask: { call: run_definition, with: { type: reasoning, name: ${marker}, input: { secret: ${marker} } } }\n`,
  },
  { name: 'limit', steps: `timeout: { after: { milliseconds: 300 } }\ndo:\n  - ${marker}: { wait: PT1H }\n` },
  { name: 'flood', steps: 'do:\n  - wait: { listen: { to: { one: { with: { type: com.acme.never } } } } }\n' },
];

async function started(port: number, name: string): Promise<readonly [string, string]> {
  const runId = randomUUID();
  await requestTo(port, 'POST', `/alpha/definitions/workflow/${name}/run`, {
    input: { secret: marker },
    run_id: runId,
  });
  return [name, runId];
}

function idOf(ids: ReadonlyMap<string, string>, name: string): string {
  const id = ids.get(name);
  if (id === undefined) {
    throw new Error(`No run of ${name} started`);
  }
  return id;
}

async function sent(port: number, runId: string, event: unknown): Promise<number> {
  const answer = await requestTo(port, 'POST', `/alpha/runs/${runId}/events`, { event });
  return answer.status;
}

const statusOf = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }));

async function settledEach(port: number, ids: ReadonlyMap<string, string>): Promise<ReadonlyMap<string, unknown>> {
  const settled = await Promise.all(
    [...ids.keys()].map(async (name): Promise<readonly [string, unknown]> => [
      name,
      await settledOver(port, `/alpha/runs/${idOf(ids, name)}`),
    ]),
  );
  return new Map(settled);
}

function statusesOf(settled: ReadonlyMap<string, unknown>): Readonly<Record<string, string>> {
  return Object.fromEntries([...settled.keys()].map((name) => [name, statusOf(settled.get(name)).status]));
}

async function createdInTurn(port: number, remaining: readonly Definition[]): Promise<void> {
  const [first, ...rest] = remaining;
  if (first !== undefined) {
    await requestTo(port, 'POST', '/alpha/definitions/workflow', {
      name: first.name,
      source: contributing(workflowSource(first.name, first.steps)),
    });
    await createdInTurn(port, rest);
  }
}

async function startedEach(port: number): Promise<ReadonlyMap<string, string>> {
  await requestTo(port, 'POST', '', { playbook: 'alpha', name: 'Alpha', goals: givenGoals });
  await createdInTurn(port, definitions);
  return new Map(await Promise.all(definitions.map(({ name }) => started(port, name))));
}

function stopped(child: SpawnedServer): Promise<unknown> {
  child.signal('SIGTERM');
  return child.exited;
}

describe('workflow tools', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a workflow calling a reasoning function whose tools end it, over HTTP', () => {
    it('catches the kind and because of a tool the server does not offer, and its history says why', async () => {
      const server = await serving();

      const { settled, answers: answersWorkflowTools } = await settledWorkflowRun(server, 'reporting');

      expect(settled).toMatchObject({
        body: { status: 'succeeded', output: { kind: 'tool_not_offered', because: 'tool_server_not_configured' } },
      });
      expect(answersWorkflowTools).toMatchObject([
        {
          summary:
            'A function the workflow called did not succeed, and 3 steps moved; the workflow ended. This server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook.',
          data: {
            input: {
              status: 'rejected',
              rejection: { kind: 'tool_not_offered', because: 'tool_server_not_configured' },
            },
          },
        },
      ]);
      expect(server.modelCalls()).toBe(0);
    });

    it('ends with the kind and because of tools that could not finish when nothing catches them', async () => {
      const server = await serving(callingTools([['graph__search', { query: 'acme' }]], timedOut));

      const { settled, answers: answersWorkflowTools } = await settledWorkflowRun(server, 'careless');

      expect(settled).toMatchObject({
        body: {
          status: 'rejected',
          rejection: { reason: 'unavailable', kind: 'tools_unfinished', because: 'model_unavailable' },
        },
      });
      expect(answersWorkflowTools).toMatchObject([
        {
          summary: unfinishedWords,
          data: { input: { rejection: { kind: 'tools_unfinished', because: 'model_unavailable' } } },
        },
      ]);
    });
  });

  describe('a workflow whose step met a tool server that could not be used, over HTTP', () => {
    it('ends as plain unavailable when a step met a tool server that could not be used, saying nothing of what was called', async () => {
      const server = await serving();

      const { settled, ending } = await settledWorkflowRun(server, 'stranded');

      expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
      expect(settled.body).not.toHaveProperty('rejection.kind');
      expect(ending).toBe('A run did not go through: something the server relies on is not available right now.');
      expect(server.modelCalls()).toBe(0);
    });
  });
});

describe('workflow tool cancellation', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a workflow step that times out while its reasoning function calls a tool', () => {
    it('aborts the call in flight at its MCP server, and ends the run cancelled with the call ended as interrupted and its spending', async () => {
      const fake = await serveFakeMcp({ bearer: apiKey });
      closing.push(fake.close);
      const clock = steppedServerClock();
      const server = await servingWorkflowToolCancellation(fake, clock);

      const startedWorkflowToolCancellation = await server.call('POST', `${alpha}/definitions/workflow/impatient/run`, {
        body: { input: {} },
      });
      await fake.once(() => fake.received().length > 0);
      clock.moveTo(clock.now() + aSecond);
      const workflow = await settledAsSwept(
        server,
        clock,
        `${alpha}/runs/${runIdIn(startedWorkflowToolCancellation.body)}`,
      );
      const calls = await untilCancelled(fake);
      const nested = String(server.modelRunIds()[0]);
      const run = await settledAsSwept(server, clock, `${alpha}/runs/${nested}`);
      const history = await server.call('GET', `${alpha}/runs/${nested}/history`);
      const again = await server.call('POST', `${alpha}/definitions/reasoning/sleeper/run`, {
        body: { input: {}, run_id: nested },
      });

      expect(workflow).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
      expect(calls.map(({ rpc }) => rpc)).toEqual(['tools/call', 'notifications/cancelled']);
      expect(calls[1]?.session).toBe(calls[0]?.session);
      expect(calls[0]?.session).toEqual(expect.any(String));
      expect(fake.received()).toMatchObject([{ tool: 'sleep', arguments: { ms: 60_000 } }]);
      expect(run).toMatchObject({
        body: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' }, record: { usage: {} } },
      });
      expect(decodeHistoryWorkflowToolCancellation(history.body).events.map(({ type }) => type)).toEqual([
        'run_started',
        'model_call_started',
        'model_call_answered',
        'tool_call_started',
        'run_cancel_requested',
        'tool_call_failed',
        'run_rejected',
      ]);
      expect(again).toMatchObject({ status: 409, body: { reason: 'cancelled', kind: 'deadline' } });
    });
  });
});

describe('workflow tenant data', () => {
  afterAll(() => {
    ledger.remove();
  });

  describe('a workflow that ends for a reason of its tenant', () => {
    it('leaves no trace of its input, document, events or nested rejections in any line the server writes', async () => {
      const child = workflowProcess(ledger.fileName);
      const port = await child.port;
      const ids = await startedEach(port);

      await sent(port, idOf(ids, 'event'), { type: 'com.acme.go', data: { secret: marker } });
      const flood = await Promise.all(
        Array.from({ length: 70 }, (_, index) =>
          sent(port, idOf(ids, 'flood'), { id: `${marker}-${index}`, type: marker, data: marker }),
        ),
      );
      const settled = await settledEach(port, ids);
      const exitCode = await stopped(child);
      const { stdout, stderr } = child.output();

      expect(exitCode).toBe(0);
      expect(flood).toContain(200);
      expect(statusesOf(settled)).toEqual({
        document: 'rejected',
        input: 'rejected',
        event: 'rejected',
        nested: 'rejected',
        limit: 'rejected',
        flood: 'rejected',
      });
      expect(JSON.stringify([...settled.values()])).toContain(marker);
      expect(`${stdout}${stderr}`).not.toContain(marker);
    });
  });
});
