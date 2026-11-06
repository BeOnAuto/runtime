import { describe, expect, it } from 'vitest';

import type { ModelRequest } from '../model/model-request.ts';
import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { chatCompletionToolCall } from '../provider-testing/tool-call-replies.ts';
import { accessFor, failed, jsonRequest, promptText, succeeded, verdictSchema } from '../testing/adapter-harness.ts';
import { documentOf, parsed } from '../testing/definition-documents.ts';
import { exposedText } from '../testing/exposure.ts';

const model = 'internal/llama-3.3-70b';

const withoutStructuredOutputs = {
  MODEL_GATEWAYS: JSON.stringify([{ name: 'internal', base_url: 'https://llm.internal.example/v1' }]),
};

const howToAnswer =
  'Answer with only a JSON value that matches this JSON Schema, and no other text. Leave out a property that is not required when you have no value for it.';

const answerText = 'ANSWER-TEXT-5b07';

async function answering(reply: object) {
  const recording = recordingFetch(() => jsonResponse(reply));
  const access = await accessFor(withoutStructuredOutputs, { fetch: recording.fetch });
  return { access, requests: recording.requests };
}

async function answerTo(text: string, request: ModelRequest = jsonRequest(model)) {
  const { access } = await answering(chatCompletion(text));
  return succeeded(access, request);
}

async function failureFor(text: string, finishReason = 'stop') {
  const { access } = await answering(chatCompletion(text, finishReason));
  const failure = await failed(access, jsonRequest(model));
  expect(exposedText(failure)).not.toContain(promptText);
  expect(exposedText(failure)).not.toContain(answerText);
  return failure;
}

describe('a JSON answer asked of a gateway without structured outputs', () => {
  it('is asked for after the instructions of the request, with its schema as written, and with no response format', async () => {
    const { access, requests } = await answering(chatCompletion('{"verdict":"approve"}'));

    const result = await succeeded(access, jsonRequest(model));

    const [request] = requests();
    expect(request?.body).toMatchObject({
      messages: [
        {
          role: 'system',
          content: `Answer briefly\n\n${howToAnswer}\n\n${JSON.stringify(verdictSchema.document)}`,
        },
        { role: 'user' },
      ],
    });
    expect(request?.body).not.toHaveProperty('response_format');
    expect(result).toMatchObject({
      text: '{"verdict":"approve"}',
      json: { verdict: 'approve' },
      output_mode: 'described',
    });
  });

  it('is asked for in instructions of its own when the request has none', async () => {
    const { access, requests } = await answering(chatCompletion('{"verdict":"approve"}'));
    const { model: named, messages, output, settings } = jsonRequest(model);

    await succeeded(access, { model: named, messages, output, settings });

    expect(requests()[0]?.body).toMatchObject({
      messages: [{ role: 'system', content: `${howToAnswer}\n\n${JSON.stringify(verdictSchema.document)}` }, {}],
    });
  });
});

describe('the answer of a gateway without structured outputs, read as JSON', () => {
  it('is read as sent, or inside one Markdown code fence with or without a language', async () => {
    const answers = await Promise.all([
      answerTo('\n{"verdict":"approve"}\n'),
      answerTo('```json\n{"verdict":"approve"}\n```'),
      answerTo('\n```\n{\n  "verdict": "approve"\n}\n```\n'),
    ]);

    expect(answers.map(({ json }) => json)).toEqual([
      { verdict: 'approve' },
      { verdict: 'approve' },
      { verdict: 'approve' },
    ]);
  });

  it.each([
    ['prose', `The verdict is ${answerText}.`],
    ['prose before its fence', `Here it is:\n\`\`\`json\n{"verdict":"${answerText}"}\n\`\`\``],
    ['prose after its fence', `\`\`\`json\n{"verdict":"${answerText}"}\n\`\`\`\nThat is ${answerText}.`],
    ['two fences', `\`\`\`json\n{"verdict":"${answerText}"}\n\`\`\`\n\`\`\`json\n{"verdict":"${answerText}"}\n\`\`\``],
    ['a fence on one line', `\`\`\`{"verdict":"${answerText}"}\`\`\``],
  ])('is refused as not JSON when it is %s', async (_case, text) => {
    expect(await failureFor(text)).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer is not JSON',
      finish_reason: 'stop',
      issues: [],
      output_mode: 'described',
    });
  });
});

describe('an answer of a gateway without structured outputs that cannot be used', () => {
  it('is checked against the schema as written, and never coerced to it', async () => {
    const [wrongType, wrongRoot] = await Promise.all([failureFor('{"verdict":42}'), failureFor('"approve"')]);

    expect([wrongType, wrongRoot]).toMatchObject([
      {
        _tag: 'output_invalid',
        detail: 'The answer does not match the output schema',
        issues: [{ pointer: '/verdict', detail: 'Expected string' }],
        output_mode: 'described',
      },
      { _tag: 'output_invalid', issues: [{ pointer: '' }], output_mode: 'described' },
    ]);
  });

  it('fails as cut off when the gateway stopped it at max_output_tokens', async () => {
    expect(await failureFor(`{"verdict":"${answerText}`, 'length')).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer was cut off at max_output_tokens before it was complete',
      finish_reason: 'length',
      output_mode: 'described',
    });
  });

  it('fails as content_refused when a content filter stopped it', async () => {
    expect(await failureFor(`{"verdict":"${answerText}"}`, 'content_filter')).toMatchObject({
      _tag: 'content_refused',
      provider: 'internal',
      output_mode: 'described',
    });
  });
});

describe('a step of a gateway without structured outputs', () => {
  it('reads no answer when the model asks for tools', async () => {
    const { access } = await answering(chatCompletionToolCall('lookup', { account: 'acme' }));
    const tools = [{ name: 'lookup', description: 'Looks an account up', inputSchema: { type: 'object' } }];

    const result = await succeeded(access, jsonRequest(model, { tools }));

    expect(result).toMatchObject({ finish_reason: 'tool_calls', output_mode: 'described' });
    expect('json' in result).toBe(false);
  });

  it('asks for a shape with the schema of the shape, and checks what the shape holds beyond it', async () => {
    const { output } = parsed(documentOf(`model: ${model}\noutput: {shape: categories}`));
    const shaped = jsonRequest(model, { output });
    const { access, requests } = await answering(chatCompletion('{"values":[{"name":"A","value":1,"low":2}]}'));

    expect(await failed(access, shaped)).toMatchObject({
      _tag: 'output_invalid',
      issues: [{ pointer: '/values/0/low', detail: 'Expected a low of at most the value' }],
      output_mode: 'described',
    });
    expect(JSON.stringify(requests()[0]?.body)).toContain('https://on.auto/shapes/categories');
    expect(
      await answerTo('```json\n{"unit":"hours","values":[{"name":"A","value":1,"low":0}]}\n```', shaped),
    ).toMatchObject({ json: { unit: 'hours', values: [{ name: 'A', value: 1, low: 0 }] } });
  });
});
