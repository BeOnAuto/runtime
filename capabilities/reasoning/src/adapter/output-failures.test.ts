import { describe, expect, it } from 'vitest';

import { openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, jsonRequest, promptText, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';

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

describe('an answer that is not usable as the JSON asked for', () => {
  it('fails as output_invalid with the issues when it does not match the schema', async () => {
    const failure = await failureFor(openAiResponse(`{"verdict":42,"note":"${answerText}"}`));

    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      provider: 'openai',
      detail: 'The answer does not match the output schema',
      finish_reason: 'stop',
      raw_finish_reason: null,
      usage,
      issues: [
        { pointer: '/note', detail: 'Expected no excess property' },
        { pointer: '/verdict', detail: 'Expected string' },
      ],
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
