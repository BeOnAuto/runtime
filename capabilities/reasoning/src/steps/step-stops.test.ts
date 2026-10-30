import { Deferred, Effect, Exit, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { RateLimited } from '../failure/rate-limited.ts';
import type { ToolCallAnswer, ToolCallJob } from '../jobs/jobs.ts';
import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';
import { defaultBounds, stepsOf, toolOf } from '../testing/step-runs.ts';

const search = toolOf('graph', 'search');

const searched: readonly ScriptedCall[] = [['graph__search', { query: 'acme' }]];

const boundWords = 'The run went on for 150 ms, the longest a run that calls tools may take';

const shortBound = { ...defaultBounds, runBoundMs: 150 };

function typesOf(recorded: readonly { readonly type: string }[]): readonly string[] {
  return recorded.map(({ type }) => type);
}

describe('a run that reaches its bound', () => {
  it('gives up the tool call in flight as cancelled, and ends at its bound', async () => {
    const sent = Deferred.makeUnsafe<true>();
    const steps = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult(searched))],
      send: () => Effect.andThen(Deferred.succeed(sent, true), Effect.never),
      bounds: shortBound,
      before: { startedAt: new Date(0).toISOString(), modelCallsBefore: 0, calls: [] },
    });
    const boundPassed = Effect.gen(function* () {
      const stepping = yield* Effect.forkChild(steps.stepping);
      yield* Deferred.await(sent);
      yield* TestClock.adjust(`${shortBound.runBoundMs} millis`);
      return yield* Fiber.join(stepping);
    });

    expect(await Effect.runPromise(Effect.provide(boundPassed, TestClock.layer()))).toMatchObject({
      ending: { type: 'stopped', because: 'run_bound', detail: boundWords },
    });
    expect(steps.journal.recorded().at(-1)).toMatchObject({
      type: 'tool_call_failed',
      data: { because: 'cancelled', detail: boundWords },
    });
  });

  it('gives up the model call in flight as cancelled, and ends at its bound', async () => {
    const steps = stepsOf({ tools: [search], replies: [() => Effect.never], bounds: shortBound });

    expect(await Effect.runPromise(steps.stepping)).toMatchObject({
      ending: { type: 'stopped', because: 'run_bound', detail: boundWords },
    });
    expect(steps.journal.recorded().at(-1)).toMatchObject({
      type: 'model_call_failed',
      data: { because: 'cancelled', detail: boundWords },
    });
  });
});

const brokenAnswer: ToolCallAnswer = {
  ended: { type: 'tool_call_failed', data: { because: 'server_failure', duration_ms: 1, jsonrpc_id: 1 } },
  reply: { text: 'The tool server graph failed: broken', isError: true },
};

function failingAllBut(last: string) {
  const lastSent = Deferred.makeUnsafe<true>();
  return ({ input }: ToolCallJob): Effect.Effect<ToolCallAnswer> =>
    input['query'] === last
      ? Effect.andThen(Deferred.succeed(lastSent, true), Effect.never)
      : Effect.as(Deferred.await(lastSent), brokenAnswer);
}

describe('a run whose tool servers fail too often', () => {
  it('stops the calls still in flight, and ends as its servers failed', async () => {
    const calls = ['a', 'b', 'c', 'd', 'e', 'f'].map((query): ScriptedCall => ['graph__search', { query }]);
    const steps = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult(calls))],
      send: failingAllBut('f'),
    });

    expect(await Effect.runPromise(steps.stepping)).toMatchObject({
      ending: { type: 'stopped', because: 'server_failed' },
      state: { serversEnded: 'failing' },
    });
    expect(steps.journal.recorded().at(-1)).toMatchObject({
      type: 'tool_call_failed',
      data: { because: 'cancelled', detail: 'The run stopped its calls once its tool servers failed too often' },
    });
  });
});

describe('a run that is interrupted while a tool call is in flight', () => {
  it('gives the call up and records nothing after its start', async () => {
    const called = Deferred.makeUnsafe<Readonly<AbortSignal>>();
    const steps = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult(searched))],
      send: () =>
        Effect.promise(
          (signal: Readonly<AbortSignal>) =>
            new Promise<ToolCallAnswer>(() => {
              Deferred.doneUnsafe(called, Effect.succeed(signal));
            }),
        ),
    });

    const signal = await Effect.runPromise(
      Effect.gen(function* () {
        const stepping = yield* Effect.forkChild(steps.stepping);
        const given = yield* Deferred.await(called);
        yield* Fiber.interrupt(stepping);
        return given;
      }),
    );

    expect(signal.aborted).toBe(true);
    expect(typesOf(steps.journal.recorded())).toEqual([
      'model_call_started',
      'model_call_answered',
      'tool_call_started',
    ]);
  });
});

describe('a run whose call another attempt recorded first', () => {
  it('stops with the conflict, making no call', async () => {
    const steps = stepsOf({
      replies: [answers(textResult('Never asked.'))],
      refusing: ({ type }) => type === 'model_call_started',
    });

    expect(await Effect.runPromiseExit(steps.stepping)).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })),
    );
    expect(steps.requests()).toEqual([]);
  });
});

const failedModelCall: ScriptedReply = () =>
  Effect.fail(
    new RateLimited({ detail: 'anthropic is limiting the rate', provider: 'anthropic', retry_after_ms: 2000 }),
  );

const failedToolCall = (): Effect.Effect<ToolCallAnswer> =>
  Effect.succeed({
    ended: { type: 'tool_call_failed', data: { because: 'timed_out', duration_ms: 30_000, jsonrpc_id: 1 } },
    reply: { text: 'The tool server graph failed', isError: true },
  });

const ends = [
  { refused: 'model_call_answered', replies: [answers(textResult('Never kept.'))] },
  { refused: 'model_call_failed', replies: [failedModelCall] },
  { refused: 'tool_call_started', replies: [answers(toolCallsResult(searched))] },
  { refused: 'tool_call_answered', replies: [answers(toolCallsResult(searched))] },
  { refused: 'tool_call_failed', replies: [answers(toolCallsResult(searched))], send: failedToolCall },
] as const;

describe('a run whose fact another attempt recorded first, whatever the fact', () => {
  it.each(ends)('stops with the conflict when $refused cannot be written', async ({ refused, replies, ...given }) => {
    const steps = stepsOf({ tools: [search], replies, ...given, refusing: ({ type }) => type === refused });

    expect(await Effect.runPromiseExit(steps.stepping)).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'taken' })),
    );
    expect(steps.journal.recorded().map(({ type }) => type)).not.toContain(refused);
  });
});
