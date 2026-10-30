import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { RateLimited } from '../failure/rate-limited.ts';
import { LanguageModel } from '../model/language-model.ts';
import { textRequest } from './adapter-harness.ts';
import { answers, jsonResult, scriptedLanguageModel, textResult, unknownUsage } from './index.ts';

const limited = new RateLimited({ detail: 'slow down', provider: 'scripted', retry_after_ms: 1000 });

describe('scriptedLanguageModel', () => {
  it('answers with its scripted results and failures in order, and records the requests', async () => {
    const script = scriptedLanguageModel(answers(textResult('first')), () => Effect.fail(limited));
    const generate = Effect.gen(function* () {
      const model = yield* LanguageModel;
      const first = yield* model.generate(textRequest('scripted/model'));
      const second = yield* Effect.flip(model.generate(textRequest('scripted/other')));
      return [first.text, second];
    });

    const replies = await Effect.runPromise(generate.pipe(Effect.provide(script.layer)));

    expect(replies).toEqual(['first', limited]);
    expect(script.requests().map((request) => request.model)).toEqual(['scripted/model', 'scripted/other']);
  });

  it('rejects an invalid request as the real model does', async () => {
    const script = scriptedLanguageModel(answers(textResult('unused')));
    const invalid = textRequest('scripted/model', { messages: [] });

    const failure = await Effect.runPromise(Effect.flip(script.languageModel.generate(invalid)));

    expect(failure).toMatchObject({ _tag: 'definition_invalid', issues: [{ pointer: '/messages' }] });
  });

  it('dies when the script has no reply left', async () => {
    const script = scriptedLanguageModel();

    const exit = await Effect.runPromiseExit(script.languageModel.generate(textRequest('scripted/model')));

    expect(Exit.hasDies(exit)).toBe(true);
  });
});

describe('the scripted results', () => {
  it('build a text result and a JSON result', () => {
    expect(textResult('Hello', { finish_reason: 'length' })).toMatchObject({
      text: 'Hello',
      finish_reason: 'length',
      usage: unknownUsage,
    });
    expect(jsonResult({ verdict: 'approve' })).toMatchObject({
      text: '{"verdict":"approve"}',
      json: { verdict: 'approve' },
    });
  });
});
