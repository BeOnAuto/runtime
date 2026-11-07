import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { OutputRequest } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';
import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { textResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { secretOfTheServers, stepsOf } from '../testing/step-runs.ts';
import { answerOfTheSteps, type StepsAnswer } from './steps-answer.ts';

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
        detail: "The answer does not match its schema once the secrets of the run's tool servers are scrubbed from it",
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
