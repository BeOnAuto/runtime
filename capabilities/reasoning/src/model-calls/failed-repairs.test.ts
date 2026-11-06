import { MockLanguageModelV4 } from 'ai/test';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { describingGateway, gatewayModel, usageOfOneAnswer } from '../provider-testing/answers-in-turn.ts';
import { generatedText, mockGeneration } from '../provider-testing/mock-models.ts';
import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { abortedWith, jsonResponse, recordingFetch, type Responder } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, jsonRequest } from '../testing/adapter-harness.ts';
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

const pastTheDeadline: Responder = ({ signal }) => abortedWith(signal);

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
