import { textResult, toolCallsResult, type ScriptedReply } from '@on.auto/reasoning/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const summary = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/search]', '---', 'Summarize acme.'].join(
  '\n',
);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

const usage = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

const decodeHistory = Schema.decodeUnknownSync(
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
  const running = await servingReasoning(first, environment, undefined, { ledger });
  onTestFinished(running.stop);
  const other = await servingReasoning([], environment, undefined, { ledger });
  onTestFinished(other.stop);
  await running.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await running.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'summary', source: summary } });
  return { graph, running, other };
}

describe('a reasoning run cancelled through another server while its model answers', () => {
  it('starts no call after the answer, and ends cancelled with the spending of its model call', async () => {
    const answering = Promise.withResolvers<void>();
    const heldThenAsking: ScriptedReply = () =>
      Effect.promise(() => answering.promise).pipe(
        Effect.as(toolCallsResult([['graph__search', { query: 'acme' }]], { usage, duration_ms: 400 })),
      );
    const { graph, running, other } = await twoServersOnOneLedger([heldThenAsking, neverAsked]);

    const asked = running.call('POST', `${alpha}/definitions/reasoning/summary/run`, {
      body: { input: {}, run_id: runId },
    });
    await until(
      () => running.modelCalls(),
      (calls) => calls > 0,
    );
    const cancelled = await other.call('POST', `${alpha}/runs/${runId}/cancel`, { body: { reason: 'Not needed' } });
    answering.resolve();
    const ended = await asked;
    const run = await other.call('GET', `${alpha}/runs/${runId}`);
    const history = await other.call('GET', `${alpha}/runs/${runId}/history`);

    expect(cancelled).toMatchObject({ status: 200, body: { run_id: runId, status: 'started' } });
    expect(ended).toMatchObject({
      status: 409,
      body: { reason: 'cancelled', kind: 'requested', detail: 'Not needed' },
    });
    expect(run.body).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested' },
      record: { usage, duration_ms: 400 },
    });
    expect(decodeHistory(history.body).events.map(({ type }) => type)).toEqual([
      'run_started',
      'model_call_started',
      'run_cancel_requested',
      'model_call_answered',
      'run_rejected',
    ]);
    expect([running.modelCalls(), graph.received()]).toEqual([1, []]);
  });
});
