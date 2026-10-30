import { describe, expect, it } from 'vitest';

import { openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { documentOf, parsed } from '../testing/definition-documents.ts';

const { output } = parsed(documentOf('model: openai/gpt-5\noutput: {shape: categories}'));

const request = textRequest('openai/gpt-5', { output });

async function answering(text: string) {
  const recording = recordingFetch(() => jsonResponse(openAiResponse(text)));
  const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch: recording.fetch });
  return { access, requests: recording.requests };
}

describe('an answer asked for in a shape', () => {
  it('is asked for with the schema of the shape, and taken when it is in the shape', async () => {
    const { access, requests } = await answering('{"unit":"hours","values":[{"name":"A","value":1,"low":0}]}');

    expect(await succeeded(access, request)).toMatchObject({
      json: { unit: 'hours', values: [{ name: 'A', value: 1, low: 0 }] },
    });
    expect(JSON.stringify(requests()[0]?.body)).toContain('"$id":"https://on.auto/shapes/categories"');
  });

  it('fails as output_invalid with the issues of the schema and of what the shape holds beyond it', async () => {
    const { access } = await answering(
      '{"values":[{"name":"A","value":1},{"name":"A","value":2,"low":3},{"name":"","value":4}]}',
    );

    expect(await failed(access, request)).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer does not match the output schema',
      issues: [
        { pointer: '/values/2/name', detail: 'Expected a value with a length of at least 1' },
        { pointer: '/values/1/name', detail: 'Expected a name no value before it has' },
        { pointer: '/values/1/low', detail: 'Expected a low of at most the value' },
      ],
    });
  });
});
