import { describe, expect, it } from 'vitest';

import { anthropicModels, vercelGatewayModels } from '../provider-testing/model-lists.ts';
import { anthropicMessage } from '../provider-testing/provider-replies.ts';
import { jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import { failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { catalogFor, idsIn } from '../testing/catalog-harness.ts';

const answering: Responder = ({ url }) => {
  if (url.endsWith('/messages')) {
    return jsonResponse(anthropicMessage('Hello'));
  }
  return jsonResponse(url.startsWith('https://api.anthropic.com/') ? anthropicModels : vercelGatewayModels);
};

function offering(allowed: readonly string[], aliases: object = {}): Readonly<Record<string, string>> {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-key',
    MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
    MODEL_ALIASES: JSON.stringify(aliases),
    ALLOWED_MODELS: JSON.stringify(allowed),
  };
}

describe('the models an operator allows', () => {
  it('are the only ones listed, by exact name or under a wildcard', async () => {
    const catalog = await catalogFor(
      offering(['anthropic/claude-sonnet-4-5-20250929', 'gateway/anthropic/*']),
      answering,
    );

    expect(idsIn(await catalog.list())).toEqual([
      'anthropic/claude-sonnet-4-5-20250929',
      'gateway/anthropic/claude-haiku-4-5',
    ]);
  });

  it('narrow the list, which says so, whereas a setting left empty narrows nothing', async () => {
    const narrowed = await catalogFor(offering(['gateway/anthropic/*']), answering);
    const open = await catalogFor({ ...offering(['gateway/anthropic/*']), ALLOWED_MODELS: '' }, answering);

    expect([(await narrowed.list()).narrowed, (await open.list()).narrowed]).toEqual([true, false]);
    expect((await narrowed.list('anthropic')).narrowed).toBe(true);
  });

  it('list an alias when its name or its target is allowed, a wildcard one only when every model it stands for is', async () => {
    const aliases = {
      'openai/*': 'gateway/openai/*',
      'house/fast': 'gateway/fast',
      'house/smart': 'gateway/smart',
      'mistral/large-*': 'gateway/large-*',
    };
    const narrow = await catalogFor(
      offering(['openai/gpt-5', 'house/fast', 'mistral/*', 'gateway/smart'], aliases),
      answering,
    );
    const wide = await catalogFor(offering(['gateway/openai/*'], aliases), answering);

    expect(idsIn(await narrow.list())).toEqual(['house/fast', 'house/smart', 'mistral/large-*']);
    expect(idsIn(await wide.list())).toEqual(['openai/*']);
  });
});

const aliased = { 'house/fast': 'anthropic/claude-haiku-4-5', 'team/smart': 'anthropic/claude-opus-4-1' };

const allowedWithAliases = ['anthropic/claude-sonnet-4-5', 'house/*', 'anthropic/claude-opus-4-1'];

describe('the models a definition may name when an operator allows some', () => {
  it('are those allowed, and an alias whose name or target is allowed; the rest fail before anything is sent', async () => {
    const catalog = await catalogFor(offering(allowedWithAliases, aliased), answering);

    const refused = [
      await failed(catalog.access, textRequest('anthropic/claude-3-haiku')),
      await failed(catalog.access, textRequest('anthropic/claude-haiku-4-5')),
    ];
    const answered = [
      await succeeded(catalog.access, textRequest('house/fast')),
      await succeeded(catalog.access, textRequest('team/smart')),
      await succeeded(catalog.access, textRequest('anthropic/claude-opus-4-1')),
      await succeeded(catalog.access, textRequest('anthropic/claude-sonnet-4-5')),
    ];

    expect(refused).toMatchObject([
      {
        _tag: 'model_not_allowed',
        detail: 'anthropic/claude-3-haiku is not one of the models this server offers',
        provider: 'anthropic',
      },
      { _tag: 'model_not_allowed', detail: 'anthropic/claude-haiku-4-5 is not one of the models this server offers' },
    ]);
    expect(answered.map(({ text }) => text)).toEqual(['Hello', 'Hello', 'Hello', 'Hello']);
    expect(catalog.requests().map(({ body }) => body)).toMatchObject([
      { model: 'claude-haiku-4-5' },
      { model: 'claude-opus-4-1' },
      { model: 'claude-opus-4-1' },
      { model: 'claude-sonnet-4-5' },
    ]);
  });

  it('agree with the list, which shows the aliases a definition may name', async () => {
    const catalog = await catalogFor(offering(allowedWithAliases, aliased), answering);

    expect(idsIn(await catalog.list('anthropic'))).toEqual(['house/fast', 'team/smart']);
  });

  it('are every model when there is no allow list', async () => {
    const catalog = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, answering);

    expect((await succeeded(catalog.access, textRequest('anthropic/claude-opus-4-1'))).text).toBe('Hello');
  });
});

const tellingAliases = {
  'house/fast': 'gateway/llama-3.3-70b',
  'openai/*': 'gateway/openai/*',
  'team/large': 'mistral/large',
};

describe('the providers and aliases a definition is told about', () => {
  it('are those it may name under the allow list, and never an alias whose provider is not configured', async () => {
    const restricted = await catalogFor(offering(['gateway/openai/*', 'house/fast'], tellingAliases), answering);
    const open = await catalogFor({ ...offering(['anthropic/*'], tellingAliases), ALLOWED_MODELS: '' }, answering);

    expect([restricted.access.offered, open.access.offered]).toEqual([
      { providers: ['gateway'], aliases: ['house/fast', 'openai/*'] },
      { providers: ['anthropic', 'gateway'], aliases: ['house/fast', 'openai/*'] },
    ]);
  });
});
