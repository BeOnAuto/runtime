import { MockLanguageModelV4 } from 'ai/test';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { describingGateway, gatewayModel, usageOfOneAnswer } from '../provider-testing/answers-in-turn.ts';
import { generatedText, mockGeneration } from '../provider-testing/mock-models.ts';
import { chatCompletion, openAiResponse } from '../provider-testing/provider-replies.ts';
import {
  answeredPastTheDeadline,
  jsonResponse,
  recordingFetch,
  type Responder,
} from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, jsonRequest, promptText, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';

const verdictIssue = { pointer: '/verdict', detail: 'Expected string' };

const anyDuration: unknown = expect.any(Number);

function wrongThen(second: Responder) {
  return recordingFetch((request, attempt) =>
    attempt === 1
      ? jsonResponse(chatCompletion('{"verdict":42}'), 200, { 'x-call-cost': '0.25' })
      : second(request, attempt),
  );
}

const serverError: Responder = () => jsonResponse({ error: { message: 'down' } }, 500);

const pastTheDeadline: Responder = ({ signal }) => answeredPastTheDeadline(signal);

function answeringThenThrowing(text: string, error: Readonly<Error>): MockLanguageModelV4 {
  const calls = { made: 0 };
  return new MockLanguageModelV4({
    doGenerate: () => {
      calls.made += 1;
      return calls.made === 1 ? Promise.resolve(generatedText(text)) : Promise.reject(error);
    },
  });
}

describe('a JSON answer that misses its schema, asked for once more by a request that fails', () => {
  it.each([
    ['answers HTTP 500', 'provider_unavailable', serverError, {}],
    ['runs past the deadline', 'timed_out', pastTheDeadline, { timeout_ms: 300 }],
  ] as const)(
    'fails with the first answer, its issues, usage and cost, when the second request %s',
    async (_what, because, second, more) => {
      const recording = wrongThen(second);
      const access = await accessFor(describingGateway, { fetch: recording.fetch });

      const failure = await failed(access, jsonRequest(gatewayModel, more));

      expect(recording.requests()).toHaveLength(2);
      expect(failure).toMatchObject({
        _tag: 'output_invalid',
        detail: 'The answer does not match the output schema',
        issues: [verdictIssue],
        usage: usageOfOneAnswer,
        cost_usd: 0.25,
        output_mode: 'described',
        repair: { outcome: 'failed', because, issues: [verdictIssue] },
      });
      expect(failure).toHaveProperty(['repair', 'duration_ms'], anyDuration);
    },
  );

  it('dies, as an error this package does not know, naming only its kind', async () => {
    const mock = answeringThenThrowing('{"verdict":42}', new TypeError('not a provider'));

    const exit = await mockGeneration(() => mock).exit(jsonRequest('mock/model'));

    expect(mock.doGenerateCalls).toHaveLength(2);
    expect(Exit.hasDies(exit)).toBe(true);
    expect(exposedText(exit)).toContain('The call to mock failed with TypeError');
  });
});

const answerText = 'ANSWER-TEXT-8e21';

function incomplete(text: string, reason: string): object {
  return { ...openAiResponse(text), status: 'incomplete', incomplete_details: { reason } };
}

async function outcome(body: object, request = jsonRequest('openai/gpt-5')) {
  const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch: recordingFetch(() => jsonResponse(body)).fetch });
  return { access, request };
}

async function failureFor(body: object, request = jsonRequest('openai/gpt-5')) {
  const { access } = await outcome(body, request);
  const failure = await failed(access, request);
  expect(exposedText(failure)).not.toContain(promptText);
  expect(exposedText(failure)).not.toContain(answerText);
  return failure;
}

const usage = {
  input: { total: 36, uncached: 16, cache_read: 20, cache_write: null },
  output: { total: 87, text: 23, reasoning: 64 },
  total: 123,
};

const usageOfBoth = {
  input: { total: 72, uncached: 32, cache_read: 40, cache_write: null },
  output: { total: 174, text: 46, reasoning: 128 },
  total: 246,
};

describe('an answer that is not usable as the JSON asked for', () => {
  it('fails as output_invalid with the issues when it does not match the schema, asked for once more too', async () => {
    const failure = await failureFor(openAiResponse(`{"verdict":42,"note":"${answerText}"}`));
    const issues = [
      { pointer: '/note', detail: 'Expected no excess property' },
      { pointer: '/verdict', detail: 'Expected string' },
    ];

    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      provider: 'openai',
      detail: 'The answer does not match the output schema',
      finish_reason: 'stop',
      raw_finish_reason: null,
      usage: usageOfBoth,
      issues,
      repair: { outcome: 'invalid', issues, usage },
    });
  });

  it('fails as output_invalid when it is not JSON', async () => {
    const failure = await failureFor(openAiResponse(`Sure! ${answerText}`));

    expect(failure).toMatchObject({ _tag: 'output_invalid', detail: 'The answer is not JSON', issues: [] });
  });

  it('fails as output_invalid when it was cut off', async () => {
    const failure = await failureFor(incomplete(`{"verdict":"${answerText}`, 'max_output_tokens'));

    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer was cut off at max_output_tokens before it was complete',
      finish_reason: 'length',
    });
  });

  it('fails as output_invalid when it was cut off before any text', async () => {
    const failure = await failureFor(incomplete('', 'max_output_tokens'));

    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      finish_reason: 'length',
      raw_finish_reason: 'max_output_tokens',
      usage,
    });
  });
});

describe('an answer stopped by a content filter', () => {
  it('fails as content_refused when JSON was asked for', async () => {
    const failure = await failureFor(incomplete(`{"verdict":"${answerText}`, 'content_filter'));

    expect(failure).toMatchObject({ _tag: 'content_refused', provider: 'openai', status: null, usage });
  });

  it('fails as content_refused when text was asked for', async () => {
    const failure = await failureFor(incomplete(answerText, 'content_filter'), textRequest('openai/gpt-5'));

    expect(failure).toMatchObject({ _tag: 'content_refused', raw_finish_reason: 'content_filter', usage });
  });
});

describe('a text answer that was cut off', () => {
  it('succeeds with the length finish reason', async () => {
    const { access, request } = await outcome(incomplete('Partial', 'max_output_tokens'), textRequest('openai/gpt-5'));

    const result = await succeeded(access, request);

    expect(result).toMatchObject({ text: 'Partial', finish_reason: 'length', raw_finish_reason: 'max_output_tokens' });
    expect('json' in result).toBe(false);
  });
});
