import { describe, expect, it } from 'vitest';

import { modelsListed } from './catalog-words.ts';
import type { ModelEntry, ModelList } from './model-list.ts';

function model(id: string, owner: string, details: Partial<ModelEntry> = {}): ModelEntry {
  return { id, object: 'model', created: 0, owned_by: owner, ...details };
}

type ListDetails = Partial<Pick<ModelList, 'catalog_status' | 'narrowed'>>;

function listOf(data: readonly ModelEntry[], details: ListDetails = {}): ModelList {
  return {
    object: 'list',
    data,
    catalog_status: 'complete',
    narrowed: false,
    listed_at: '2026-10-01T09:00:00.000Z',
    ...details,
  };
}

describe('the plain words for the models a server can call', () => {
  it('count them, name the providers, and name each model as its provider does, or by the last part of its id', () => {
    const list = listOf([
      model('anthropic/claude-sonnet-4-5', 'anthropic', { name: 'Claude Sonnet 4.5' }),
      model('gateway/meta/llama-3.3-70b', 'gateway'),
      model('house/fast', 'gateway', { alias: true, resolved_to: 'gateway/meta/llama-3.3-70b' }),
    ]);

    expect(modelsListed(list)).toBe(
      'This server can call 3 models through anthropic and gateway: Claude Sonnet 4.5, llama-3.3-70b, and fast.',
    );
  });

  it('say the provider of a name two providers share, and the id of a name one provider repeats', () => {
    const list = listOf([
      model('anthropic/claude-haiku-4-5', 'anthropic', { name: 'Claude Haiku 4.5' }),
      model('anthropic/claude-3-5-sonnet-20240620', 'anthropic', { name: 'Claude Sonnet 3.5' }),
      model('anthropic/claude-3-5-sonnet-20241022', 'anthropic', { name: 'Claude Sonnet 3.5' }),
      model('gateway/anthropic/claude-haiku-4-5', 'gateway', { name: 'Claude Haiku 4.5' }),
    ]);

    expect(modelsListed(list)).toBe(
      'This server can call 4 models through anthropic and gateway: Claude Haiku 4.5 (anthropic), claude-3-5-sonnet-20240620, claude-3-5-sonnet-20241022, and Claude Haiku 4.5 (gateway).',
    );
  });

  it('name twenty and count the rest', () => {
    const many = Array.from({ length: 23 }, (_, index) =>
      model(`gateway/model-${String(index).padStart(2, '0')}`, 'gateway'),
    );

    expect(modelsListed(listOf(many))).toBe(
      `This server can call 23 models through gateway: ${many
        .slice(0, 20)
        .map(({ id }) => id.slice('gateway/'.length))
        .join(', ')}, and 3 more.`,
    );
  });
});

describe('the plain words for models named by a pattern', () => {
  it('say which providers take any model id, after the models or on their own', () => {
    const patterns = [
      model('anthropic/*', 'gateway', { pattern: true }),
      model('openai/gpt-*', 'gateway', { pattern: true }),
      model('router/meta-llama/*', 'gateway', { pattern: true }),
    ];

    expect(modelsListed(listOf([model('gateway/fast', 'gateway', { name: 'Fast' }), ...patterns]))).toBe(
      'This server can call 1 model through gateway: Fast. It can also call any anthropic model, any openai model starting with gpt-, and any router model starting with meta-llama.',
    );
    expect(modelsListed(listOf([model('bedrock/*', 'bedrock', { pattern: true })]))).toBe(
      'This server can call any bedrock model.',
    );
  });
});

describe('the plain words for no model, or a list that may be incomplete', () => {
  it('say when there is none, through any provider or the one asked about', () => {
    expect(modelsListed(listOf([]))).toBe('This server has no model it can call.');
    expect(modelsListed(listOf([]), 'mistral')).toBe('This server has no model it can call through mistral.');
  });

  it('say how a person adds a provider, where the server says, when it has none at all', () => {
    const setup = 'To add one, the person puts a key in the settings of the server.';

    expect(modelsListed(listOf([]), undefined, setup)).toBe(`This server has no model it can call. ${setup}`);
    expect(modelsListed(listOf([]), 'mistral', setup)).toBe('This server has no model it can call through mistral.');
  });

  it('say when a provider could not be asked', () => {
    expect(modelsListed(listOf([model('gateway/fast', 'gateway')], { catalog_status: 'partial' }))).toBe(
      'This server can call 1 model through gateway: fast. The list may be incomplete: a provider could not be asked just now.',
    );
  });
});

describe('the plain words for a list an allow list narrows', () => {
  it('say that it holds only what its operator allows, after the models and before an incomplete list', () => {
    const narrowed: ListDetails = { narrowed: true };

    expect(modelsListed(listOf([model('gateway/fast', 'gateway')], narrowed))).toBe(
      'This server can call 1 model through gateway: fast. It lists only the models its operator allows.',
    );
    expect(modelsListed(listOf([model('bedrock/*', 'bedrock', { pattern: true })], narrowed))).toBe(
      'This server can call any bedrock model. It lists only the models its operator allows.',
    );
    expect(modelsListed(listOf([], narrowed), 'mistral')).toBe(
      'This server has no model it can call through mistral. It lists only the models its operator allows.',
    );
    expect(modelsListed(listOf([model('gateway/fast', 'gateway')], { ...narrowed, catalog_status: 'partial' }))).toBe(
      'This server can call 1 model through gateway: fast. It lists only the models its operator allows. The list may be incomplete: a provider could not be asked just now.',
    );
  });
});
