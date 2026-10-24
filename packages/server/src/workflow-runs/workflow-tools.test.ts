import { TimedOut } from '@on.auto/reasoning';
import { callingTools, type ScriptedReplies, type ScriptedReply } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

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

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

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
    body: { name: 'graph', source: reasoningFunction('graph/search') },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'crm', source: reasoningFunction('crm/search') },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'reporting', source: workflowCalling('reporting', 'crm', true) },
  });
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'down', source: reasoningFunction('down/search') },
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
  const started = await server.call('POST', `${alpha}/definitions/workflow/${name}/run`, { body: { input: {} } });
  const runId = runIdIn(started.body);
  const settled = await settledRun(server, `${alpha}/runs/${runId}`);
  const history = await server.call('GET', `${alpha}/runs/${runId}/history`);
  const { events } = decodeHistory(history.body);
  const answers = events.filter(({ summary }) => summary.startsWith('A function'));
  const ending = events.find(({ type }) => type === 'run_rejected')?.summary;
  return { settled, answers, ending };
}

describe('a workflow calling a reasoning function whose tools end it, over HTTP', () => {
  it('catches the kind and because of a tool the server does not offer, and its history says why', async () => {
    const server = await serving();

    const { settled, answers } = await settledWorkflowRun(server, 'reporting');

    expect(settled).toMatchObject({
      body: { status: 'succeeded', output: { kind: 'tool_not_offered', because: 'tool_server_not_configured' } },
    });
    expect(answers).toMatchObject([
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

    const { settled, answers } = await settledWorkflowRun(server, 'careless');

    expect(settled).toMatchObject({
      body: {
        status: 'rejected',
        rejection: { reason: 'unavailable', kind: 'tools_unfinished', because: 'model_unavailable' },
      },
    });
    expect(answers).toMatchObject([
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
