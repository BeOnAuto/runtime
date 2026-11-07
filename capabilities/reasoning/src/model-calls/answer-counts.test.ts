import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Effect, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LanguageModel } from '../model/language-model.ts';
import type { ModelRequest } from '../model/model-request.ts';
import { answersInTurn, describingGateway, gatewayModel } from '../provider-testing/answers-in-turn.ts';
import { generatedText, mockGeneration } from '../provider-testing/mock-models.ts';
import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonRequest, textRequest } from '../testing/adapter-harness.ts';

type Generate = LanguageModel['Service']['generate'];

interface Counted {
  readonly attributes: Metric.Metric.AttributeSet | undefined;
  readonly state: unknown;
}

async function countedFor(generate: Generate, request: ModelRequest): Promise<readonly Counted[]> {
  const snapshots = await Effect.runPromise(
    Effect.andThen(Effect.exit(generate(request)), Metric.snapshot).pipe(
      Effect.provideService(Metric.MetricRegistry, new Map()),
    ),
  );
  const counted: Counted[] = [];
  for (const { id, attributes, state } of snapshots) {
    if (id === 'auto.on.json_answers') {
      counted.push({ attributes, state });
    }
  }
  return counted;
}

function answering(...texts: readonly string[]): Generate {
  const doGenerate = texts.map((text) => generatedText(text));
  return mockGeneration(() => new MockLanguageModelV4({ doGenerate })).generate;
}

const mockCall = {
  'gen_ai.operation.name': 'chat',
  'gen_ai.provider.name': 'mock',
  'gen_ai.request.model': 'mock/model',
};

const once: unknown = expect.objectContaining({ count: 1 });

describe('the JSON answers of the calls of a model', () => {
  it.each([
    ['valid', ['{"verdict":"approve"}'], {}],
    ['valid_after_repair', ['{"verdict":42}', '{"verdict":"approve"}'], {}],
    ['invalid', ['{"verdict":42}', '{"verdict":43}'], {}],
    ['repair_skipped', ['{"verdict":42}'], { room: { input_tokens: 1 } }],
  ] as const)('are counted as %s, by provider and model', async (outcome, texts, more) => {
    const counted = await countedFor(answering(...texts), jsonRequest('mock/model', more));

    expect(counted).toEqual([{ attributes: { ...mockCall, 'auto.on.outcome': outcome }, state: once }]);
  });

  it('are counted with the output mode of a call that described the schema to the model', async () => {
    const { access } = await answersInTurn(describingGateway, chatCompletion('{"verdict":"approve"}'));

    const counted = await countedFor(access.languageModel.generate, jsonRequest(gatewayModel));

    expect(counted.map(({ attributes }) => attributes)).toEqual([
      {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'internal',
        'gen_ai.request.model': gatewayModel,
        'auto.on.outcome': 'valid',
        'auto.on.output_mode': 'described',
      },
    ]);
  });
});

const filtered = {
  ...generatedText('{"verdict":"approve"}'),
  finishReason: { unified: 'content-filter', raw: 'filter' } as const,
};

const serverError = new APICallError({ message: 'down', url: 'https://x', requestBodyValues: {}, statusCode: 500 });

function answeringThenFailing(text: string): Generate {
  const calls = { made: 0 };
  const doGenerate = () => {
    calls.made += 1;
    return calls.made === 1 ? Promise.resolve(generatedText(text)) : Promise.reject(serverError);
  };
  return mockGeneration(() => new MockLanguageModelV4({ doGenerate })).generate;
}

describe('the JSON answers of the calls of a model that did not answer them', () => {
  it('are counted as repair_failed when the request for a correction failed, and as refused when the model refused', async () => {
    const counted = await Promise.all([
      countedFor(answeringThenFailing('{"verdict":42}'), jsonRequest('mock/model')),
      countedFor(
        mockGeneration(() => new MockLanguageModelV4({ doGenerate: filtered })).generate,
        jsonRequest('mock/model'),
      ),
    ]);

    expect(counted.map((each) => each.map(({ attributes }) => attributes?.['auto.on.outcome']))).toEqual([
      ['repair_failed'],
      ['refused'],
    ]);
  });
});

const schemaRefused = new APICallError({
  message: 'Invalid schema for response_format',
  url: 'https://x',
  requestBodyValues: {},
  statusCode: 400,
});

function refusingTheSchema(answer: string | null): Generate {
  const calls = { made: 0 };
  const doGenerate = () => {
    calls.made += 1;
    return calls.made === 1 || answer === null ? Promise.reject(schemaRefused) : Promise.resolve(generatedText(answer));
  };
  return mockGeneration(() => new MockLanguageModelV4({ doGenerate })).generate;
}

function byOutcome(counted: readonly Counted[]): readonly Counted[] {
  return counted.toSorted((one, other) =>
    String(one.attributes?.['auto.on.outcome']).localeCompare(String(other.attributes?.['auto.on.outcome'])),
  );
}

describe('the JSON answers of the calls of a model whose schema the provider refused', () => {
  it('count the refusal as schema_refused, with no output mode, beside the answer asked for in described mode', async () => {
    const counted = await countedFor(refusingTheSchema('{"verdict":"approve"}'), jsonRequest('mock/model'));

    expect(byOutcome(counted)).toEqual([
      { attributes: { ...mockCall, 'auto.on.outcome': 'schema_refused' }, state: once },
      { attributes: { ...mockCall, 'auto.on.outcome': 'valid', 'auto.on.output_mode': 'described' }, state: once },
    ]);
  });

  it('count nothing when the provider refused the request asked in described mode too, as the schema was not the cause', async () => {
    const counted = await countedFor(refusingTheSchema(null), jsonRequest('mock/model'));

    expect(counted).toEqual([]);
  });
});

describe('the answers of the calls of a model that are not counted as JSON answers', () => {
  it('are a text answer, a refused text answer, an answer that asks for tools, and a call that failed otherwise', async () => {
    const asksForTools = new MockLanguageModelV4({
      doGenerate: {
        ...generatedText(''),
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{}' }],
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      },
    });
    const tools = [{ name: 'lookup', description: 'Looks an account up', inputSchema: { type: 'object' } }];
    const failing = new MockLanguageModelV4({ doGenerate: () => Promise.reject(serverError) });

    const counted = await Promise.all([
      countedFor(answering('Hello'), textRequest('mock/model')),
      countedFor(
        mockGeneration(() => new MockLanguageModelV4({ doGenerate: filtered })).generate,
        textRequest('mock/model'),
      ),
      countedFor(mockGeneration(() => asksForTools).generate, jsonRequest('mock/model', { tools })),
      countedFor(mockGeneration(() => failing).generate, jsonRequest('mock/model')),
    ]);

    expect(counted).toEqual([[], [], [], []]);
  });
});
