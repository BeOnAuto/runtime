import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicModels, vercelGatewayModels } from '../provider-testing/model-lists.ts';
import { jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import { catalogFor, idsIn } from '../testing/catalog-harness.ts';

const gateways = JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]);

const anthropicAndGateway: Responder = ({ url }) =>
  jsonResponse(url.startsWith('https://api.anthropic.com/') ? anthropicModels : vercelGatewayModels);

describe('the models a server can call', () => {
  it('are those of every provider, then the aliases by their own name and marked as aliases, sorted, as of the oldest list', async () => {
    const catalog = await catalogFor(
      {
        ANTHROPIC_API_KEY: 'sk-ant-key',
        MODEL_GATEWAYS: gateways,
        MODEL_ALIASES: JSON.stringify({
          'house/fast': 'gateway/anthropic/claude-haiku-4-5',
          'openai/*': 'gateway/openai/*',
        }),
      },
      anthropicAndGateway,
    );

    const list = await catalog.list();

    expect(list).toMatchObject({ object: 'list', catalog_status: 'complete', narrowed: false });
    expect(Date.parse(list.listed_at)).toBeLessThanOrEqual(Date.now());
    expect(list.data.filter(({ owned_by: ownedBy }) => ownedBy === 'gateway').map(({ id }) => id)).toEqual([
      'gateway/alibaba/qwen-3-14b',
      'gateway/anthropic/claude-haiku-4-5',
      'house/fast',
      'openai/*',
    ]);
    expect(list.data.find(({ id }) => id === 'house/fast')).toEqual({
      id: 'house/fast',
      object: 'model',
      created: 0,
      owned_by: 'gateway',
      alias: true,
      resolved_to: 'gateway/anthropic/claude-haiku-4-5',
    });
    expect(list.data.find(({ id }) => id === 'openai/*')).toEqual({
      id: 'openai/*',
      object: 'model',
      created: 0,
      owned_by: 'gateway',
      alias: true,
      resolved_to: 'gateway/openai/*',
      pattern: true,
    });
    expect(list.data.filter(({ alias }) => alias === true).map(({ id }) => id)).toEqual(['house/fast', 'openai/*']);
  });
});

describe('a model an alias sends elsewhere', () => {
  it('leave out what an alias sends elsewhere, since naming it reaches the alias', async () => {
    const catalog = await catalogFor(
      {
        ANTHROPIC_API_KEY: 'sk-ant-key',
        MODEL_GATEWAYS: gateways,
        MODEL_ALIASES: JSON.stringify({ 'anthropic/claude-haiku-4-5-20251001': 'gateway/anthropic/claude-haiku-4-5' }),
      },
      anthropicAndGateway,
    );

    const anthropic = (await catalog.list('anthropic')).data;

    expect(anthropic.map(({ id, owned_by: ownedBy }) => [id, ownedBy])).toEqual([
      ['anthropic/claude-opus-4-1-20250805', 'anthropic'],
      ['anthropic/claude-sonnet-4-5-20250929', 'anthropic'],
    ]);
    expect((await catalog.list('gateway')).data.map(({ id }) => id)).toContain('anthropic/claude-haiku-4-5-20251001');
  });

  it('name each model once, as its provider listed it first', async () => {
    const twice = {
      data: [
        { id: 'llama', name: 'First' },
        { id: 'llama', name: 'Second' },
      ],
    };
    const catalog = await catalogFor({ MODEL_GATEWAYS: gateways }, () => jsonResponse(twice));

    expect((await catalog.list()).data).toEqual([
      { id: 'gateway/llama', object: 'model', created: 0, owned_by: 'gateway', name: 'First' },
    ]);
  });
});

describe('the models of one provider', () => {
  it('are only those of one provider, which alone is asked, when one is named', async () => {
    const catalog = await catalogFor(
      { ANTHROPIC_API_KEY: 'sk-ant-key', MODEL_GATEWAYS: gateways, MODEL_ALIASES: '{"house/fast":"gateway/fast"}' },
      anthropicAndGateway,
    );

    const list = await catalog.list('gateway');

    expect(catalog.requests().map(({ url }) => url)).toEqual(['https://gateway.example.com/v1/models']);
    expect(idsIn(list)).toEqual(['gateway/alibaba/qwen-3-14b', 'gateway/anthropic/claude-haiku-4-5', 'house/fast']);
    expect(await catalog.list('mistral')).toMatchObject({ data: [], catalog_status: 'complete' });
  });
});

describe('the models of providers that do not list their own', () => {
  it('are the models declared for a provider that does not list its own, or any model of it when none is', async () => {
    const catalog = await catalogFor(
      {
        AWS_REGION: 'eu-central-1',
        GOOGLE_VERTEX_PROJECT: 'acme-ai-project',
        GOOGLE_VERTEX_LOCATION: 'europe-west4',
        DECLARED_MODELS: JSON.stringify({
          bedrock: ['eu.anthropic.claude-sonnet-4-5-20250929-v1:0'],
          vertex: ['gemini-2.5-flash'],
        }),
      },
      () => jsonResponse({}),
    );

    const list = await catalog.list();

    expect(catalog.requests()).toEqual([]);
    expect(list).toMatchObject({ catalog_status: 'complete' });
    expect(list.data).toEqual([
      { id: 'bedrock-anthropic/*', object: 'model', created: 0, owned_by: 'bedrock-anthropic', pattern: true },
      {
        id: 'bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
        object: 'model',
        created: 0,
        owned_by: 'bedrock',
      },
      { id: 'vertex-anthropic/*', object: 'model', created: 0, owned_by: 'vertex-anthropic', pattern: true },
      { id: 'vertex/gemini-2.5-flash', object: 'model', created: 0, owned_by: 'vertex' },
    ]);
  });

  it('name an alias as one, without where it is sent, when its target is an ARN, which names an account and a region', async () => {
    const target = 'bedrock-anthropic/arn:aws:bedrock:eu-central-1:123456789012:application-inference-profile/a1b2c3';
    const catalog = await catalogFor(
      { AWS_REGION: 'eu-central-1', MODEL_ALIASES: JSON.stringify({ 'house/claims': target }) },
      () => jsonResponse({}),
    );

    expect((await catalog.list()).data).toContainEqual({
      id: 'house/claims',
      object: 'model',
      created: 0,
      owned_by: 'bedrock-anthropic',
      alias: true,
    });
  });
});

describe('an alias whose target a definition cannot call', () => {
  it('is left out when the provider of its target is not configured, as the description of reasoning leaves it out', async () => {
    const aliases = {
      'house/fast': 'gateway/llama-3.3-70b',
      'team/large': 'mistral/large',
      'meta/*': 'together/meta/*',
    };
    const catalog = await catalogFor({ MODEL_GATEWAYS: gateways, MODEL_ALIASES: JSON.stringify(aliases) }, () =>
      jsonResponse({ data: [] }),
    );

    expect(idsIn(await catalog.list())).toEqual(['house/fast']);
    expect(catalog.access.offered.aliases).toEqual(['house/fast']);
  });
});

describe('a server with no provider', () => {
  it('are none, and as of now, on a server with no provider, even with aliases', async () => {
    const before = Date.now();
    const catalog = await catalogFor({ MODEL_ALIASES: '{"house/fast":"gateway/llama-3.3-70b"}' }, () =>
      jsonResponse({}),
    );

    const list = await catalog.list();

    expect(list).toMatchObject({ object: 'list', data: [], catalog_status: 'complete' });
    expect(Date.parse(list.listed_at)).toBeGreaterThanOrEqual(before);
  });
});

describe('the context window of the model a run names', () => {
  it('is the one its provider lists for it, through an alias too, and unknown where the provider does not say', async () => {
    const catalog = await catalogFor(
      {
        ANTHROPIC_API_KEY: 'sk-ant-key',
        MODEL_ALIASES: JSON.stringify({ 'house/fast': 'anthropic/claude-haiku-4-5-20251001' }),
      },
      () => jsonResponse(anthropicModels),
    );
    const windowOf = (model: string) => Effect.runPromise(catalog.access.catalog.contextWindowOf(model));

    expect([
      await windowOf('anthropic/claude-sonnet-4-5-20250929'),
      await windowOf('house/fast'),
      await windowOf('anthropic/claude-opus-4-1-20250805'),
      await windowOf('anthropic/claude-unlisted'),
      await windowOf('gateway/llama'),
      await windowOf('unnamed'),
    ]).toEqual([200_000, 200_000, undefined, undefined, undefined, undefined]);
  });
});
