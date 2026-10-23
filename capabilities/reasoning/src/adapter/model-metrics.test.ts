import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Effect, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import { generatedText, mockGeneration } from '../provider-testing/mock-models.ts';
import { textRequest } from '../testing/adapter-harness.ts';

interface Measured {
  readonly id: string;
  readonly attributes: Metric.Metric.AttributeSet | undefined;
  readonly state: unknown;
}

const measuredIds = new Set(['gen_ai.client.token.usage', 'gen_ai.client.operation.duration']);

async function measuredFor(doGenerate: MockLanguageModelV4['doGenerate']): Promise<readonly Measured[]> {
  const { generate } = mockGeneration(() => new MockLanguageModelV4({ doGenerate }));
  const snapshots = await Effect.runPromise(
    Effect.andThen(Effect.exit(generate(textRequest('mock/model'))), Metric.snapshot).pipe(
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
  );
  const measured: Measured[] = [];
  for (const { id, attributes, state } of snapshots) {
    if (measuredIds.has(id)) {
      measured.push({ id, attributes, state });
    }
  }
  return measured;
}

const callAttributes = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': 'mock',
  'gen_ai.request.model': 'mock/model',
};

const answeredAttributes = { ...callAttributes, 'gen_ai.response.model': 'mock-model-2026' };

describe('a call of a model that answered', () => {
  it('is timed, and its tokens are counted by whether they were sent or answered', async () => {
    const measured = await measuredFor(() => Promise.resolve(generatedText('Hello')));

    expect(measured.map(({ id, attributes }) => [id, attributes])).toEqual([
      ['gen_ai.client.operation.duration', answeredAttributes],
      ['gen_ai.client.token.usage', { ...answeredAttributes, 'gen_ai.token.type': 'input' }],
      ['gen_ai.client.token.usage', { ...answeredAttributes, 'gen_ai.token.type': 'output' }],
    ]);
    expect(measured.map(({ state }) => state)).toMatchObject([{ count: 1 }, { sum: 120 }, { sum: 40 }]);
  });

  it('counts no tokens when the provider did not say how many there were', async () => {
    const unknown = { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined };
    const measured = await measuredFor(() =>
      Promise.resolve({
        ...generatedText('Hello'),
        usage: { inputTokens: unknown, outputTokens: { total: undefined, text: undefined, reasoning: undefined } },
      }),
    );

    expect(measured.map(({ id }) => id)).toEqual(['gen_ai.client.operation.duration']);
  });
});

describe('a call of a model that failed', () => {
  it('is timed with the kind of its failure, or as unclassified when no kind fits it', async () => {
    const serverError = new APICallError({ message: 'down', url: 'https://x', requestBodyValues: {}, statusCode: 500 });
    const failed = await measuredFor(() => Promise.reject(serverError));
    const unclassified = await measuredFor(() => Promise.reject(new TypeError('not an error of a provider')));

    expect([...failed, ...unclassified].map(({ attributes }) => attributes?.['error.type'])).toEqual([
      'provider_unavailable',
      'unclassified',
    ]);
  });
});
