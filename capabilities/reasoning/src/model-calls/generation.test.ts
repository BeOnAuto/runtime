import { MockLanguageModelV4 } from 'ai/test';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { generatedText, mockGeneration } from '../provider-testing/mock-models.ts';
import { compileAnswerSchema } from '../schema/answer-schema.ts';
import { jsonRequest, promptText, textRequest, verdictSchema } from '../testing/adapter-harness.ts';

function answering(result: () => ReturnType<typeof generatedText>): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doGenerate: () => Promise.resolve(result()) });
}

const conversation = textRequest('mock/model', {
  instructions: 'Be exact',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'First' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Second' },
        { type: 'text', text: 'part' },
      ],
    },
  ],
  settings: { max_output_tokens: 64, temperature: 0.3, top_p: 0.9, seed: 7, stop_sequences: ['END'], reasoning: 'low' },
  provider_options: { mock: { mode: 'fast', depth: [1, { level: 'deep' }], flag: null } },
});

describe('the call a generation makes', () => {
  it('sends every setting, the provider options and the whole conversation', async () => {
    const model = answering(() => generatedText('Hello'));

    await mockGeneration(() => model).succeeded(conversation);

    expect(model.doGenerateCalls[0]).toMatchObject({
      maxOutputTokens: 64,
      temperature: 0.3,
      topP: 0.9,
      seed: 7,
      stopSequences: ['END'],
      reasoning: 'low',
      providerOptions: { mock: { mode: 'fast', depth: [1, { level: 'deep' }], flag: null } },
      prompt: [
        { role: 'system', content: 'Be exact' },
        { role: 'user', content: [{ type: 'text', text: 'First' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Second' },
            { type: 'text', text: 'part' },
          ],
        },
      ],
    });
  });

  it('omits the settings and instructions that were not given', async () => {
    const model = answering(() => generatedText('Hello'));
    const { instructions: _, ...withoutInstructions } = textRequest('mock/model');

    await mockGeneration(() => model).succeeded(withoutInstructions);

    const [call] = model.doGenerateCalls;
    expect(call?.prompt).toHaveLength(1);
    expect(call).toMatchObject({ maxOutputTokens: 256 });
    expect(call?.temperature).toBeUndefined();
    expect(call?.providerOptions).toBeUndefined();
  });
});

const helloRequestBytes = new TextEncoder().encode(
  JSON.stringify({
    instructions: 'Answer briefly',
    messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }],
  }),
).byteLength;

describe('the result of a generation', () => {
  it('maps the usage, the identity of the answer and its duration', async () => {
    const result = await mockGeneration(() => answering(() => generatedText('Hello'))).succeeded(
      textRequest('mock/model'),
    );

    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect({ ...result, duration_ms: 0 }).toEqual({
      text: 'Hello',
      finish_reason: 'stop',
      raw_finish_reason: 'end_turn',
      usage: {
        input: { total: 120, uncached: 20, cache_read: 90, cache_write: 10 },
        output: { total: 40, text: 15, reasoning: 25 },
        total: 160,
      },
      model: { requested: 'mock/model', resolved: 'mock/model', answered: 'mock-model-2026' },
      response_id: 'response-1',
      warnings: [],
      response: JSON.stringify([{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]),
      request_bytes: helloRequestBytes,
      duration_ms: 0,
    });
  });

  it('reports unknown token counts as null and no response id when the provider gave none', async () => {
    const unknown = { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined };
    const model = answering(() => ({
      ...generatedText('Hello'),
      usage: { inputTokens: unknown, outputTokens: { total: undefined, text: undefined, reasoning: undefined } },
      response: { modelId: 'mock-model-2026' },
      finishReason: { unified: 'other', raw: undefined },
    }));

    const result = await mockGeneration(() => model).succeeded(textRequest('mock/model'));

    expect(result).toMatchObject({
      response_id: null,
      finish_reason: 'other',
      raw_finish_reason: null,
      usage: {
        input: { total: null, uncached: null, cache_read: null, cache_write: null },
        output: { total: null, text: null, reasoning: null },
        total: null,
      },
    });
  });
});

describe('the warnings and finish reasons of a generation', () => {
  it('passes every kind of warning on', async () => {
    const model = answering(() => ({
      ...generatedText('Hello'),
      warnings: [
        { type: 'unsupported', feature: 'temperature', details: 'ignored by this model' },
        { type: 'compatibility', feature: 'toolChoice' },
        { type: 'deprecated', setting: 'topK', message: 'Use reasoning' },
        { type: 'other', message: 'Slow region' },
      ],
    }));

    const result = await mockGeneration(() => model).succeeded(textRequest('mock/model'));

    expect(result.warnings).toEqual([
      { type: 'unsupported', feature: 'temperature', detail: 'ignored by this model' },
      { type: 'compatibility', feature: 'toolChoice', detail: null },
      { type: 'deprecated', feature: 'topK', detail: 'Use reasoning' },
      { type: 'other', feature: null, detail: 'Slow region' },
    ]);
  });

  it.each([
    ['tool-calls', 'tool_calls'],
    ['error', 'error'],
    ['length', 'length'],
  ] as const)('maps the finish reason %s', async (unified, expected) => {
    const model = answering(() => ({ ...generatedText('Hello'), finishReason: { unified, raw: unified } }));

    const result = await mockGeneration(() => model).succeeded(textRequest('mock/model'));

    expect(result.finish_reason).toBe(expected);
  });
});

describe('a generation of JSON', () => {
  it('returns the validated value and describes the output to the model', async () => {
    const model = answering(() => generatedText('{"verdict":"approve"}'));
    const output = { type: 'json', schema: verdictSchema, name: 'verdict', description: 'The verdict' } as const;

    const result = await mockGeneration(() => model).succeeded(jsonRequest('mock/model', { output }));

    expect(result.json).toEqual({ verdict: 'approve' });
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({
      type: 'json',
      name: 'verdict',
      description: 'The verdict',
    });
  });

  it('fails as output_invalid when the answer holds a string out of the form its schema names', async () => {
    const dated = Result.getOrThrow(
      compileAnswerSchema({
        type: 'object',
        properties: { due: { type: 'string', format: 'date' } },
        required: ['due'],
      }),
    );
    const model = answering(() => generatedText('{"due":"next Friday"}'));

    const failure = await mockGeneration(() => model).failed(
      jsonRequest('mock/model', { output: { type: 'json', schema: dated } }),
    );

    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer does not match the output schema',
      issues: [{ pointer: '/due', detail: 'Expected a string in the format date, such as 2026-04-01' }],
    });
  });

  it('sends an unnamed output without a name or description', async () => {
    const model = answering(() => generatedText('{"verdict":"approve"}'));

    await mockGeneration(() => model).succeeded(
      jsonRequest('mock/model', { output: { type: 'json', schema: verdictSchema } }),
    );

    expect(model.doGenerateCalls[0]?.responseFormat).toEqual({ type: 'json', schema: verdictSchema.document });
  });
});
