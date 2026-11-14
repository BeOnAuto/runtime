import type { TokenUsage } from '@on.auto/reasoning';
import {
  answers,
  textResult,
  toolCallsResult,
  type ScriptedCall,
  type ScriptedReplies,
  type ScriptedReply,
} from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const stoppingAtALimit = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/*]', '---', 'Plan.'].join('\n');

const answeringAtALimit = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'tools: [graph/*]',
  'exit_behavior: continue',
  '---',
  'Plan.',
].join('\n');

const sixThousand: TokenUsage = {
  input: { total: 6000, uncached: 6000, cache_read: null, cache_write: null },
  output: { total: 20, text: 20, reasoning: null },
  total: null,
};

const searched: ScriptedCall = ['graph__search', { query: 'acme' }];

const echoed: ScriptedCall = ['graph__echo', { said: 'acme' }];

function readingThenAsking(first: ScriptedCall, last: ScriptedReply): readonly ScriptedReply[] {
  return [answers(toolCallsResult([first], { usage: sixThousand, request_bytes: 24_000 })), last];
}

const askedForMore = answers(toolCallsResult([['graph__search', { query: 'acme 2' }]]));

const answered = answers(textResult('Acme has 2 rows.'));

async function serving(source: string, replies: readonly ScriptedReplies[]) {
  const fake = await serveFakeMcp();
  onTestFinished(fake.close);
  const server = await servingReasoning(replies, {
    REASONING_MAX_INPUT_TOKENS: '10000',
    TOOL_SERVERS: JSON.stringify({ graph: { url: fake.url, org: 'acme' } }),
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'planner', source, diagram: 'none' } });
  return { server, sent: () => fake.received().length };
}

function ranUnder(server: ReasoningServer) {
  return server.call('POST', `${alpha}/definitions/reasoning/planner/run`, { body: { input: {}, run_id: runId } });
}

const advice =
  'Ask each tool for less, such as one page of what it holds, or run the function once for each item from a workflow; to have it answer from what it has instead, where an answer from part of the work will do, set exit_behavior: continue in the reasoning function definition';

describe('a reasoning run that reaches its input tokens and asks for more, over HTTP', () => {
  it('is a conflict that names the limit, 409, recorded so, sending nothing more, and tools_called under its id', async () => {
    const { server, sent } = await serving(stoppingAtALimit, [readingThenAsking(searched, askedForMore)]);

    const first = await ranUnder(server);
    const read = await server.call('GET', `${alpha}/runs/${runId}`);
    const again = await ranUnder(server);

    const stopped = {
      reason: 'conflict',
      kind: 'unworkable',
      because: 'max_input_tokens',
      detail: `The run needed more than the 10,000 input tokens a run may read, after the run called the search tool of graph. ${advice}`,
    };
    expect([first.status, first.body]).toEqual([409, expect.objectContaining(stopped)]);
    expect(read.body).toMatchObject({ status: 'rejected', rejection: stopped });
    expect([again.status, again.body]).toEqual([
      409,
      expect.objectContaining({ kind: 'tools_called', because: 'only_read' }),
    ]);
    expect([server.modelCalls(), sent()]).toEqual([2, 1]);
  });

  it('is effect_unknown, 409, once it called a tool that declares nothing', async () => {
    const { server } = await serving(stoppingAtALimit, [readingThenAsking(echoed, askedForMore)]);

    expect((await ranUnder(server)).body).toMatchObject({
      reason: 'conflict',
      kind: 'effect_unknown',
      because: 'max_input_tokens',
    });
  });
});

function callsOf(tool: string, count: number): readonly ScriptedCall[] {
  return Array.from({ length: count }, (_, call): ScriptedCall => [`graph__${tool}`, { query: `acme ${call}` }]);
}

const countingAll = (most: number) =>
  ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/*]', `max_tool_calls: ${most}`, '---', 'Plan.'].join(
    '\n',
  );

const pastTheActingCalls: unknown = expect.stringMatching(
  /^The run needed more than the 25 calls a run may make of tools not marked reads\./u,
);

describe('a reasoning run whose step asks for more tool calls than its count, over HTTP', () => {
  it('is a conflict that names the limit, 409, sending none of that step’s calls, past 25 of tools not marked reads', async () => {
    const { server, sent } = await serving(stoppingAtALimit, [answers(toolCallsResult(callsOf('echo', 26)))]);

    const ran = await ranUnder(server);

    expect([ran.status, ran.body, sent()]).toEqual([
      409,
      expect.objectContaining({
        reason: 'conflict',
        kind: 'unworkable',
        because: 'max_tool_calls',
        detail: pastTheActingCalls,
      }),
      0,
    ]);
  });

  it('makes and answers past 25 calls of a tool marked reads, which the default count leaves out', async () => {
    const { server, sent } = await serving(stoppingAtALimit, [
      answers(toolCallsResult(callsOf('search', 30))),
      answered,
    ]);

    const ran = await ranUnder(server);

    expect([ran.status, ran.body, sent()]).toEqual([200, expect.objectContaining({ output: 'Acme has 2 rows.' }), 30]);
  });

  it('counts reads too under the function’s own max_tool_calls', async () => {
    const { server, sent } = await serving(countingAll(3), [answers(toolCallsResult(callsOf('search', 4)))]);

    const ran = await ranUnder(server);

    expect([ran.status, ran.body, sent()]).toEqual([
      409,
      expect.objectContaining({ kind: 'unworkable', because: 'max_tool_calls' }),
      0,
    ]);
  });
});

describe('a reasoning run whose function says continue, at its input tokens, over HTTP', () => {
  it('succeeds with incomplete_details beside its output, in its answer, get_run, list_runs and its history', async () => {
    const { server } = await serving(answeringAtALimit, [readingThenAsking(searched, answered)]);

    const ran = await ranUnder(server);
    const read = await server.call('GET', `${alpha}/runs/${runId}`);
    const listed = await server.call('GET', `${alpha}/runs`);
    const history = await server.call('GET', `${alpha}/runs/${runId}/history?order=desc&limit=1`);

    const marked = { incomplete_details: { reason: 'max_input_tokens' } };
    expect([ran.status, ran.body]).toEqual([200, expect.objectContaining({ output: 'Acme has 2 rows.', ...marked })]);
    expect(read.body).toMatchObject({ status: 'succeeded', ...marked });
    expect(listed.body).toMatchObject({ runs: [{ run_id: runId, status: 'succeeded', ...marked }] });
    expect(history.body).toMatchObject({
      events: [
        {
          type: 'run_succeeded',
          summary: 'A run finished with an answer from what it had, after it had read as much as a run may read.',
        },
      ],
    });
  });
});

const catchingTheLimit = workflowSource(
  'planning',
  `do:
  - plan:
      try:
        - think: { call: run_definition, with: { type: reasoning, name: planner, input: {} } }
      catch:
        as: failure
        errors:
          with: { because: max_input_tokens }
        do:
          - note: { set: { kind: '\${ $failure.kind }', because: '\${ $failure.because }', status: '\${ $failure.status }' } }
`,
);

const leavingItUncaught = workflowSource(
  'planning',
  `do:
  - think: { call: run_definition, with: { type: reasoning, name: planner, input: {} } }
`,
);

async function planned(workflow: string, first: ScriptedCall) {
  const { server } = await serving(stoppingAtALimit, [readingThenAsking(first, askedForMore)]);
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'planning', source: workflow } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/planning/run`, { body: { input: {} } });
  return (await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`)).body;
}

describe('a workflow whose reasoning step stops at its input tokens', () => {
  it('takes the branch its catch names by the because of the limit', async () => {
    expect(await planned(catchingTheLimit, searched)).toMatchObject({
      status: 'succeeded',
      output: { kind: 'unworkable', because: 'max_input_tokens', status: 409 },
    });
  });

  it('is rejected naming the step and its limit when it does not catch it, as any 409 of a step is', async () => {
    const step = { step: 'do/0/think', status: 'rejected', reason: 'conflict', because: 'max_input_tokens' };

    expect([await planned(leavingItUncaught, searched), await planned(leavingItUncaught, echoed)]).toMatchObject([
      {
        status: 'rejected',
        rejection: { reason: 'invalid_input', issues: [], cause: { ...step, kind: 'unworkable' } },
      },
      {
        status: 'rejected',
        rejection: {
          reason: 'conflict',
          kind: 'effect_unknown',
          because: 'max_input_tokens',
          cause: { ...step, kind: 'effect_unknown' },
        },
      },
    ]);
  });
});
