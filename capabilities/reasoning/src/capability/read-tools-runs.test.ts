import { recordingJournal } from '@on.auto/definitions/testing';
import { DateTime, Effect, Exit, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { moment, reasoningAdapter, runContextWith } from '../testing/reasoning-runs.ts';
import { aGraph, graphAccessTo } from '../testing/resumed-attempts.ts';
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
