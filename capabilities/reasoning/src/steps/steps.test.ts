import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { OutputRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { budgetOf } from '../testing/input-budgets.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { defaultBounds, secretOfTheServers, stepsOf, toolOf } from '../testing/step-runs.ts';
import { answerOfTheSteps, type StepsAnswer } from './steps-answer.ts';

const anyWords: unknown = expect.any(String);

const search = toolOf('graph', 'search');

const counted = {
  input: { total: 1200, uncached: 1200, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 1240,
};

describe('the room of a run that calls tools, sent with each model call', () => {
  it("is the input tokens the run has left, the model's context window and when the run's bound ends", async () => {
    const startedAt = new Date().toISOString();
    const steps = stepsOf({
      tools: [search],
      before: { startedAt, modelCallsBefore: 0, calls: [] },
      bounds: { ...defaultBounds, runBoundMs: 600_000, limits: { contextWindow: 200_000, budget: budgetOf(50_000) } },
      replies: [
        answers(toolCallsResult([['graph__search', { query: 'acme' }]], { usage: counted })),
        answers(textResult('Acme has 2 rows.')),
      ],
    });

    await Effect.runPromise(steps.stepping);

    const endsAt = Date.parse(startedAt) + 600_000;
    expect(steps.requests().map(({ room }) => room)).toEqual([
      { input_tokens: 50_000, context_window: 200_000, ends_at: endsAt },
      { input_tokens: 48_800, context_window: 200_000, ends_at: endsAt },
    ]);
  });

  it('is no input tokens at all once the run has spent them', async () => {
    const steps = stepsOf({
      tools: [search],
      bounds: { ...defaultBounds, runBoundMs: 600_000, limits: { contextWindow: undefined, budget: budgetOf(1000) } },
      replies: [
        answers(toolCallsResult([['graph__search', { query: 'acme' }]], { usage: counted })),
        answers(textResult('Acme has 2 rows.')),
      ],
    });

    await Effect.runPromise(steps.stepping);

    expect(steps.requests().map(({ room }) => room?.input_tokens)).toEqual([1000, 0]);
  });
});

const keyed: OutputRequest = {
  type: 'json',
  schema: Result.getOrThrow(
    compileAnswerSchema({
      type: 'object',
      properties: { key: { type: 'string', minLength: 20 } },
      required: ['key'],
    }),
  ),
};

const named: OutputRequest = {
  type: 'json',
  schema: Result.getOrThrow(
    compileAnswerSchema({
      type: 'object',
      properties: { name: { type: 'string' }, nickname: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    }),
  ),
};

async function answeredWith(
  text: string,
  output: OutputRequest,
  overrides: Partial<ModelResult> = {},
): Promise<Result.Result<StepsAnswer, unknown>> {
  const { state, ending } = await Effect.runPromise(
    stepsOf({ replies: [answers(textResult(text, overrides))] }).stepping,
  );
  return ending.type === 'answered'
    ? answerOfTheSteps(state, ending, { model: 'anthropic/claude-sonnet-4-5', output, tools: [] })
    : Result.fail(ending);
}

describe('the answer of the steps, checked again once the secrets of the tool servers are scrubbed from it', () => {
  it('is kept while it still matches its schema, and refused as invalid output once it no longer parses or matches', async () => {
    const asIs = await answeredWith('{"key":"a key of twenty characters"}', keyed);
    const scrubbed = await answeredWith(`{"key":"${secretOfTheServers}"}`, keyed);
    const broken = await answeredWith('{"key": [redacted]}', keyed);
    const text = await answeredWith(`It is ${secretOfTheServers}.`, { type: 'text' });

    expect(Result.map(asIs, ({ output }) => output)).toEqual(Result.succeed({ key: 'a key of twenty characters' }));
    expect(Result.map(text, ({ output }) => output)).toEqual(Result.succeed('It is [redacted].'));
    expect([scrubbed, broken]).toMatchObject([
      Result.fail({
        number: 1,
        because: 'output_invalid',
        provider: 'scripted',
        detail: anyWords,
        issues: [{ pointer: '/key' }],
      }),
      Result.fail({ because: 'output_invalid', issues: [{ pointer: '', detail: 'The scrubbed answer is not JSON' }] }),
    ]);
  });

  it('reads an answer the model wrote inside one code fence from inside it, as the call read it', async () => {
    const fenced = await answeredWith('```json\n{"key":"a key of twenty characters"}\n```', keyed);

    expect(Result.map(fenced, ({ output }) => output)).toEqual(Result.succeed({ key: 'a key of twenty characters' }));
  });

  it('reads an answer the call asked for in the portable form back into the schema as written, and any other as written', async () => {
    const written = '{"name":"Ada","nickname":null}';
    const portable = await answeredWith(written, named, { output_mode: 'portable' });
    const described = await answeredWith(written, named, { output_mode: 'described' });
    const older = await answeredWith(written, named);

    expect(Result.map(portable, ({ output, result }) => ({ output, text: result.text }))).toEqual(
      Result.succeed({ output: { name: 'Ada' }, text: written }),
    );
    expect([described, older]).toMatchObject([
      Result.fail({ because: 'output_invalid', issues: [{ pointer: '/nickname' }] }),
      Result.fail({ because: 'output_invalid', issues: [{ pointer: '/nickname' }] }),
    ]);
  });
});
