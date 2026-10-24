import { Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { ContentRefused, ModelNotAllowed, OutputInvalid, TimedOut, type ModelFailure } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { jsonResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { reasoningOf, reasoningWith } from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  graphKey,
  stopping,
  upToTheFirst,
  withGraphTools,
} from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

const usage = {
  input: { total: 900, uncached: 100, cache_read: 800, cache_write: 0 },
  output: { total: 120, text: 100, reasoning: 20 },
  total: 1020,
};

function answeredAfter(milliseconds: number, failureOf: () => ModelFailure): ScriptedReply {
  return () => TestClock.adjust(`${milliseconds} millis`).pipe(Effect.andThen(Effect.fail(failureOf())));
}

function invalidAnswer(finishReason: 'stop' | 'length'): () => ModelFailure {
  return () =>
    new OutputInvalid({
      detail: 'The answer is not JSON',
      provider: 'openai',
      finish_reason: finishReason,
      raw_finish_reason: null,
      usage,
      issues: [],
    });
}

const refused = (): ModelFailure =>
  new ContentRefused({
    detail: 'openai stopped the answer under its content policy',
    provider: 'openai',
    status: null,
    raw_finish_reason: 'content_filter',
    usage,
  });

const stillCalling = answers(
  toolCallsResult([['graph__search', { query: 'acme' }]], {
    usage,
    duration_ms: 1500,
    model: { requested: 'openai/gpt-5', resolved: 'openai/gpt-5', answered: 'gpt-5' },
  }),
);

describe('a run rejected after its model answered', () => {
  it('records the tokens the answer used and how long the model took, whatever the rejection', async () => {
    const record = { usage, duration_ms: 1500 };

    const runs = await Promise.all(
      [
        ...[invalidAnswer('stop'), invalidAnswer('length'), refused].map((failureOf) => answeredAfter(1500, failureOf)),
        stillCalling,
      ].map((reply) => reasoningWith(reply).running(jsonDefinition, { text: 'x' })),
    );

    expect(runs).toMatchObject([
      Exit.fail(new Unavailable({ detail: 'The answer is not JSON; try again', record })),
      Exit.fail({ _tag: 'conflict', record }),
      Exit.fail({ _tag: 'invalid_input', record }),
      Exit.fail(
        new Unavailable({
          detail: 'openai kept calling tools in the step that withheld them, instead of answering',
          record,
        }),
      ),
    ]);
  });
});

const record = { usage, duration_ms: 1500 };

function asking(calls: readonly ScriptedCall[]): ScriptedReply {
  return answers(toolCallsResult(calls, { usage, duration_ms: 1500 }));
}

const broken = [1, 2, 3, 4, 5].map((attempt): ScriptedCall => ['graph__broken', { attempt }]);

const timedOut: ScriptedReply = () =>
  Effect.fail(
    new TimedOut({ detail: 'anthropic did not answer within 60000 ms', provider: 'anthropic', timeout_ms: 60_000 }),
  );

const noLongerAllowed: ScriptedReply = () =>
  Effect.fail(
    new ModelNotAllowed({
      detail: 'anthropic/claude-sonnet-4-5 is not one of the models this server offers',
      provider: 'anthropic',
    }),
  );

async function resumedAtTheStartOf(call: ScriptedCall, entry: Readonly<Record<string, unknown>> = {}) {
  const tools = graphAccessTo((await aGraph()).url, entry);
  const first = reasoningOf({ tools }, asking([call]), stopping);
  await first.running(withGraphTools);
  const attempt = attemptOf(upToTheFirst(first.journal.calls(), 'tool_call_started'));
  return reasoningOf({ tools, attempt, content: first.content }).running(withGraphTools);
}

describe('a run that called tools, rejected however it ended', () => {
  it('records the spending of its model calls when its servers failed, its model timed out or was no longer allowed, a call had no known outcome or its content was gone', async () => {
    const tools = graphAccessTo((await aGraph()).url);
    const runs = [
      await reasoningOf({ tools }, asking(broken)).running(withGraphTools),
      await reasoningOf({ tools }, asking([['graph__search', { query: 'acme' }]]), timedOut).running(withGraphTools),
      await reasoningOf({ tools }, asking([['graph__search', { query: 'acme' }]]), noLongerAllowed).running(
        withGraphTools,
      ),
      await resumedAtTheStartOf(['graph__echo', { said: 'acme' }]),
      await resumedAtTheStartOf(['graph__search', { query: 'acme' }], { record_content: false }),
    ];

    expect(runs).toMatchObject([
      Exit.fail({ because: 'server_failed', record }),
      Exit.fail({ because: 'model_unavailable', record }),
      Exit.fail({ kind: 'tools_unfinished', because: 'model_unavailable', record }),
      Exit.fail({ because: 'call_outcome_unknown', record }),
      Exit.fail({ because: 'restarted_without_content', record }),
    ]);
  });
});

const keyedWithTools = documentOf(
  [
    'model: anthropic/claude-sonnet-4-5',
    'tools: [graph/search]',
    'output:',
    '  format: json',
    '  schema: {type: object, properties: {key: {type: string, minLength: 20}}, required: [key]}',
  ].join('\n'),
  'Which key?',
);

describe('a run whose answer no longer matches its schema once the secrets of its tool servers are scrubbed from it', () => {
  it('is unavailable as the answer of a model that did not match its schema, with its spending', async () => {
    const tools = graphAccessTo((await aGraph()).url);
    const answer = JSON.stringify({ key: graphKey });
    const run = reasoningOf(
      { tools },
      answers(jsonResult({ key: graphKey }, { text: answer, usage, duration_ms: 1500 })),
    );

    const scrubbedAway: unknown = expect.stringMatching(
      /^The answer does not match its schema once the secrets .* \(\/key: .*\); try again$/u,
    );

    expect(await run.running(keyedWithTools)).toMatchObject(
      Exit.fail({ _tag: 'unavailable', detail: scrubbedAway, record }),
    );
  });
});
