import { cancelledByAnother, recordingJournal } from '@on.auto/definitions/testing';
import { DateTime, Effect, Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { moment, reasoningAdapter, reasoningOf, runContextWith } from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  stopping,
  upToTheFirst,
  withGraphTools,
} from '../testing/resumed-attempts.ts';
import { answers, scriptedLanguageModel } from '../testing/scripted-language-model.ts';
import { readToolsNoticeOf } from '../tools/read-tools-notice.ts';

const naming = (tools: string) => documentOf(`model: anthropic/claude-sonnet-4-5\ntools: [${tools}]`, 'Judge it.');

const calledBy = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/judge', run: 1 };

async function recordOf(source: string, given: { readonly calledBy?: Readonly<typeof calledBy> } = {}) {
  const fake = await aGraph();
  const { languageModel } = scriptedLanguageModel(
    answers(toolCallsResult([['graph__profile', {}]])),
    answers(textResult('Record 7 is open, so it stays.')),
  );
  const capability = reasoningAdapter({ languageModel, tools: graphAccessTo(fake.url) });
  const context = { ...runContextWith(recordingJournal()), ...given };
  const exit = await Effect.runPromiseExit(
    TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
      Effect.andThen(Effect.flatMap(capability.prepare(source), (prepared) => prepared.run({}, context))),
      Effect.provide(TestClock.layer()),
    ),
  );
  return Exit.match(exit, {
    onFailure: () => ({}),
    onSuccess: (answer): Schema.JsonObject => answer.record,
  });
}

describe('the record of a run the agent asked for, of a reasoning function whose tools are all marked reads', () => {
  it('carries the notice its save gives, from the marks the run already holds', async () => {
    const record = await recordOf(naming('graph/profile'));

    expect(record).toMatchObject({ notices: [readToolsNoticeOf([{ server: 'graph', tool: 'profile' }])] });
  });

  it('carries none for a run a workflow started, or where a tool it names may act', async () => {
    const records = [
      await recordOf(naming('graph/profile'), { calledBy }),
      await recordOf(naming('graph/profile, graph/echo')),
    ];

    expect(records.map((record) => 'notices' in record)).toEqual([false, false]);
    expect(records.map((record) => 'model' in record)).toEqual([true, true]);
  });

  it('carries none for a function that names no tools', async () => {
    const { languageModel } = scriptedLanguageModel(answers(textResult('It stays.')));
    const capability = reasoningAdapter({ languageModel });
    const answer = await Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment))).pipe(
        Effect.andThen(
          Effect.flatMap(
            capability.prepare(documentOf('model: anthropic/claude-sonnet-4-5', 'Judge it.')),
            (prepared) => prepared.run({}, runContextWith(recordingJournal())),
          ),
        ),
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(JSON.stringify(answer)).not.toContain('notices');
  });
});

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
