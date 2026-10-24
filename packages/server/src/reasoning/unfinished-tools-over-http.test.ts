import { TimedOut, type TokenUsage } from '@on.auto/reasoning';
import {
  answers,
  callingTools,
  textResult,
  toolCallsResult,
  type ScriptedCall,
  type ScriptedReplies,
  type ScriptedReply,
} from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const source = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/*]', '---', 'Summarize acme.'].join('\n');

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const unused = answers(textResult('Never asked.'));

const heavy: TokenUsage = {
  input: { total: 1_500_000, uncached: 1_500_000, cache_read: null, cache_write: null },
  output: { total: 10, text: 10, reasoning: null },
  total: null,
};

function callingThenKeptCalling(calls: readonly ScriptedCall[]): readonly ScriptedReply[] {
  return callingTools(calls, answers(toolCallsResult(calls)), { usage: heavy });
}

const searched: ScriptedCall = ['graph__search', { query: 'acme' }];

const echoed: ScriptedCall = ['graph__echo', { said: 'acme' }];

const broken = [1, 2, 3, 4, 5].map((attempt): ScriptedCall => ['graph__broken', { attempt }]);

async function serving(replies: readonly ScriptedReplies[]): Promise<ReasoningServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  onTestFinished(fake.close);
  const server = await servingReasoning(replies, {
    GRAPH_API_KEY: apiKey,
    TOOL_SERVERS: JSON.stringify({
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
    }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source } });
  return server;
}

async function endedTwice(reply: ScriptedReplies) {
  const server = await serving([reply]);
  const running = { body: { input: {}, run_id: runId } };
  const first = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, running);
  const again = await server.call('POST', `${alpha}/definitions/reasoning/summary/run`, running);
  return [first.status, first.body, again.status];
}

function endedAs(status: number, kind: string, because: string): readonly unknown[] {
  return [status, expect.objectContaining({ kind, because }), 409];
}

describe('a reasoning run that called only tools that read and could not finish, over HTTP', () => {
  it.each([
    ['five server failures', callingTools(broken, unused), 'server_failed'],
    ['a model that stopped answering', callingTools([searched], timedOut), 'model_unavailable'],
    ['a final step that still called tools', callingThenKeptCalling([searched]), 'no_answer'],
  ])('is tools_unfinished, 503, after %s, and tools_called under its id', async (_case, reply, because) => {
    expect(await endedTwice(reply)).toEqual(endedAs(503, 'tools_unfinished', because));
  });
});

const mayChange: ReadonlyArray<readonly [string, ScriptedReplies, string]> = [
  ['before the tools that read', callingTools([echoed, searched], timedOut), 'model_unavailable'],
  ['after the tools that read', callingThenKeptCalling([searched, echoed]), 'no_answer'],
  ['whose servers then kept failing', callingTools([echoed, ...broken], unused), 'server_failed'],
];

describe('a reasoning run that called a tool that may change something and could not finish, over HTTP', () => {
  it.each(mayChange)(
    'is effect_unknown, 409, when it called one %s, and tools_called under its id',
    async (_case, reply, because) => {
      expect(await endedTwice(reply)).toEqual(endedAs(409, 'effect_unknown', because));
    },
  );

  it('ends as before when it called no tool', async () => {
    const [status, body] = await endedTwice(timedOut);

    expect(status).toBe(503);
    expect(body).not.toHaveProperty('kind');
  });
});

const retryingOn503 = workflowSource(
  'reviewing',
  `do:
  - review:
      try:
        - summarize: { call: run_definition, with: { type: reasoning, name: summary, input: {} } }
      catch:
        errors:
          with: { status: 503 }
        retry:
          delay: PT0.01S
          limit:
            attempt: { count: 3 }
`,
);

async function reviewed(replies: readonly ScriptedReplies[]) {
  const server = await serving(replies);
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'reviewing', source: retryingOn503 } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/reviewing/run`, { body: { input: {} } });
  const ended = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);
  return { ended: ended.body, modelCalls: server.modelCalls() };
}

describe('a workflow whose reasoning step called tools and could not finish', () => {
  it('never retries on status 503 a step whose tool may have changed something, raised at 409 under its own type', async () => {
    expect(await reviewed([callingTools([echoed], timedOut)])).toMatchObject({
      ended: {
        status: 'rejected',
        rejection: { reason: 'conflict', kind: 'effect_unknown', because: 'model_unavailable' },
      },
      modelCalls: 2,
    });
  });

  it('retries on status 503 a step whose tools only read', async () => {
    const unfinished = callingTools([searched], timedOut);

    expect(await reviewed([unfinished, unfinished, answers(textResult('Acme has 2 rows.'))])).toMatchObject({
      ended: { status: 'succeeded', output: 'Acme has 2 rows.' },
      modelCalls: 5,
    });
  });
});
