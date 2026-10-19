import { describe, expect, it } from 'vitest';

import { catalogFor } from '../testing/catalog-harness.ts';
import { liteLlmModels, vercelGatewayModels } from '../testing/model-lists.ts';
import { jsonResponse } from '../testing/recording-fetch.ts';

const gateway = {
  name: 'gateway',
  base_url: 'https://llm.internal.example/v1/',
  api_key_env: 'GATEWAY_KEY',
  headers: { 'x-tenant': 'acme-tenant' },
  query_params: { 'api-version': '2026-09-01' },
};

function withGateway(entry: object, declared?: object): Readonly<Record<string, string>> {
  return {
    MODEL_GATEWAYS: JSON.stringify([entry]),
    GATEWAY_KEY: 'gateway-secret-key',
    ...(declared === undefined ? {} : { DECLARED_MODELS: JSON.stringify(declared) }),
  };
}

describe('the models of a gateway', () => {
  it('are read from its list with its key, headers and query parameters, keeping its language models', async () => {
    const catalog = await catalogFor(withGateway(gateway), () => jsonResponse(vercelGatewayModels));

    const list = await catalog.list();

    expect(catalog.requests()).toMatchObject([
      {
        url: 'https://llm.internal.example/v1/models?api-version=2026-09-01',
        headers: { authorization: 'Bearer gateway-secret-key', 'x-tenant': 'acme-tenant' },
      },
    ]);
    expect(list.data).toEqual([
      {
        id: 'gateway/alibaba/qwen-3-14b',
        object: 'model',
        created: 1_755_815_280,
        owned_by: 'gateway',
        name: 'Qwen3-14B',
        context_window: 40_960,
        max_tokens: 16_384,
      },
      {
        id: 'gateway/anthropic/claude-haiku-4-5',
        object: 'model',
        created: 1_760_486_400,
        owned_by: 'gateway',
        name: 'Claude Haiku 4.5',
        context_window: 200_000,
        max_tokens: 64_000,
      },
    ]);
  });
});

describe('a gateway that answers in the shape of OpenAI', () => {
  it('are read from a list in the shape OpenAI answers, without a key when the gateway has none', async () => {
    const catalog = await catalogFor(withGateway({ name: 'gateway', base_url: 'https://litellm.example/v1' }), () =>
      jsonResponse(liteLlmModels),
    );

    const list = await catalog.list();

    expect(catalog.requests()[0]?.url).toBe('https://litellm.example/v1/models');
    expect(catalog.requests()[0]?.headers['authorization']).toBeUndefined();
    expect(list.data).toEqual([
      { id: 'gateway/acme-internal/claims-triage', object: 'model', created: 1_677_610_602, owned_by: 'gateway' },
      { id: 'gateway/llama-3.3-70b', object: 'model', created: 1_677_610_602, owned_by: 'gateway' },
    ]);
  });

  it('skip an entry without an id, and take only the details that have the type they should', async () => {
    const entries = [
      'not an entry',
      { name: 'No id' },
      { id: ' ' },
      { id: 'fast', created: '2026-01-01', name: 7, context_window: 1.5, max_tokens: -1, type: 3 },
      { id: 'smart', created: 1_700_000_000.9, name: '  ', context_window: 0 },
    ];
    const catalog = await catalogFor(withGateway(gateway), () => jsonResponse({ data: entries }));

    expect((await catalog.list()).data).toEqual([
      { id: 'gateway/fast', object: 'model', created: 0, owned_by: 'gateway' },
      { id: 'gateway/smart', object: 'model', created: 1_700_000_000, owned_by: 'gateway' },
    ]);
  });
});

describe('a gateway without a list of models', () => {
  it('fall back to the models declared for it when it has no list, and say the list is partial', async () => {
    const catalog = await catalogFor(withGateway(gateway, { gateway: ['llama-3.3-70b'] }), () =>
      jsonResponse({ error: { message: 'Not Found' } }, 404),
    );

    const list = await catalog.list();

    expect(list).toMatchObject({
      data: [{ id: 'gateway/llama-3.3-70b', object: 'model', created: 0, owned_by: 'gateway' }],
      catalog_status: 'partial',
    });
  });
});

const hostileIds = [
  '',
  '   ',
  'fast\nsmart',
  'fast\u0000smart',
  'x'.repeat(3000),
  'gpt-*',
  'arn:aws:bedrock:eu-central-1:123456789012:x',
];

const hostileNames = ['Line one\nLine two', 'Nul\u0000name', 'x'.repeat(3000), 'Paragraph\u2029apart'];

interface Trickling {
  readonly answer: () => Response;
  readonly reads: () => number;
}

function trickling(text: string): Trickling {
  const bytes = new TextEncoder().encode(text);
  const counted = { reads: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        const at = counted.reads;
        counted.reads += 1;
        if (at < bytes.length) {
          controller.enqueue(bytes.subarray(at, at + 1));
        } else {
          controller.close();
        }
      },
    },
    { highWaterMark: 0 },
  );
  return {
    answer: () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    reads: () => counted.reads,
  };
}

describe('the entries of a gateway that cannot be shown', () => {
  it('are left out when their id is empty, has a space or a control character, is too long, has a * or is an ARN', async () => {
    const entries = [...hostileIds.map((id) => ({ id })), { id: 'gpt-4\u043E' }, { id: 'llama-3.3-70b' }];
    const catalog = await catalogFor(withGateway(gateway), () => jsonResponse({ data: entries }));

    expect((await catalog.list()).data.map(({ id }) => id)).toEqual(['gateway/gpt-4\u043E', 'gateway/llama-3.3-70b']);
  });

  it('keep their id but not a name that spans lines, holds a control character or is longer than 100 characters', async () => {
    const entries = [
      ...hostileNames.map((name, index) => ({ id: `model-${index}`, name })),
      { id: 'fast', name: 'Fast' },
    ];
    const catalog = await catalogFor(withGateway(gateway), () => jsonResponse({ data: entries }));

    expect((await catalog.list()).data.map(({ id, name }) => [id, name])).toEqual([
      ['gateway/fast', 'Fast'],
      ['gateway/model-0', undefined],
      ['gateway/model-1', undefined],
      ['gateway/model-2', undefined],
      ['gateway/model-3', undefined],
    ]);
  });
});

describe('an answer that arrives in many small pieces', () => {
  it('is read in one pass, each of 80,000 pieces of one byte once, and the end once', async () => {
    const text = JSON.stringify({ data: [{ id: 'llama-3.3-70b' }] }).padEnd(80_000, ' ');
    const pieces = trickling(text);
    const catalog = await catalogFor(withGateway(gateway), pieces.answer);

    const list = await catalog.list();

    expect([pieces.reads(), list.data.map(({ id }) => id)]).toEqual([80_001, ['gateway/llama-3.3-70b']]);
  });
});
