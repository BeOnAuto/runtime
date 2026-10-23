import { cancelledByAnother } from '@on.auto/definitions/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { reasoningOf } from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  stopping,
  upToTheFirst,
  withGraphTools,
} from '../testing/resumed-attempts.ts';
import { answers } from '../testing/scripted-language-model.ts';

const usage = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

const asking = answers(toolCallsResult([['graph__search', { query: 'acme' }]], { usage, duration_ms: 400 }));

const record = { usage, duration_ms: 400 };

describe('a run whose cancel another server recorded once its model asked for a tool', () => {
  it('starts no call after it and ends cancelled as asked, with the spending of its model call', async () => {
    const graph = await aGraph();
    const run = reasoningOf({ tools: graphAccessTo(graph.url), cancelledAfter: 2 }, asking);

    expect(await run.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: 'cancelled', detail: cancelledByAnother.detail, kind: 'requested', record }),
      ),
    );
    expect([run.requests().length, graph.received()]).toEqual([1, []]);
  });
});

describe('a run whose cancel another server recorded once its tool answered', () => {
  it('makes no second model call and ends cancelled, the tool called once', async () => {
    const graph = await aGraph();
    const run = reasoningOf(
      { tools: graphAccessTo(graph.url), cancelledAfter: 4 },
      asking,
      answers(textResult('Never asked.')),
    );

    expect(await run.running(withGraphTools)).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'cancelled', kind: 'requested', record })),
    );
    expect([run.requests().length, graph.received().length]).toEqual([1, 1]);
    expect(run.journal.recorded().map(({ type }) => type)).toEqual([
      'model_call_started',
      'model_call_answered',
      'tool_call_started',
      'tool_call_answered',
    ]);
  });
});

describe('a run cancelled in its process while a call of it is in flight', () => {
  it('ends that call as interrupted, a tool call or the model call, with the spending of its model calls so far', async () => {
    const graph = await aGraph();
    const first = reasoningOf({ tools: graphAccessTo(graph.url) }, asking, stopping);
    await first.running(withGraphTools);
    const calls = first.journal.calls();
    const prepared = Effect.runSync(first.capability.prepare(withGraphTools));

    expect(prepared.cancelledAttempt(attemptOf(upToTheFirst(calls, 'tool_call_started')))).toMatchObject({
      ends: [{ type: 'tool_call_failed', data: { number: 1, because: 'interrupted', jsonrpc_id: null } }],
      record,
    });
    expect(prepared.cancelledAttempt(attemptOf(calls))).toMatchObject({
      ends: [{ type: 'model_call_failed', data: { number: 2, because: 'interrupted', provider: 'scripted' } }],
      record,
    });
  });
});
