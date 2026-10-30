import { describe, expect, it } from 'vitest';

import { anthropicModels } from '../provider-testing/model-lists.ts';
import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { catalogFor } from '../testing/catalog-harness.ts';

describe('the models of anthropic', () => {
  it('are read from its list of models with the key, and listed with the name and limits it reports', async () => {
    const catalog = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, () => jsonResponse(anthropicModels));

    const list = await catalog.list();

    expect(catalog.requests()).toMatchObject([
      {
        url: 'https://api.anthropic.com/v1/models?limit=1000',
        method: 'GET',
        headers: { 'x-api-key': 'sk-ant-key', 'anthropic-version': '2023-06-01' },
      },
    ]);
    expect(list.data).toEqual([
      {
        id: 'anthropic/claude-haiku-4-5-20251001',
        object: 'model',
        created: 1_759_276_800,
        owned_by: 'anthropic',
        name: 'Claude Haiku 4.5',
        context_window: 200_000,
        max_tokens: 64_000,
      },
      {
        id: 'anthropic/claude-opus-4-1-20250805',
        object: 'model',
        created: 1_754_352_000,
        owned_by: 'anthropic',
        name: 'Claude Opus 4.1',
      },
      {
        id: 'anthropic/claude-sonnet-4-5-20250929',
        object: 'model',
        created: 1_759_104_000,
        owned_by: 'anthropic',
        name: 'Claude Sonnet 4.5',
        context_window: 200_000,
        max_tokens: 64_000,
      },
    ]);
    expect(list.catalog_status).toBe('complete');
  });
});

describe('the list of models of anthropic over several pages', () => {
  it('follows the pages of the list, with a bearer token and the base URL that is set', async () => {
    const pages = [
      {
        data: [{ id: 'claude-sonnet-4-5', type: 'model' }],
        has_more: true,
        first_id: 'a',
        last_id: 'claude-sonnet-4-5',
      },
      { data: [{ id: 'claude-haiku-4-5', type: 'model', created_at: 'not a date' }], has_more: false, last_id: null },
    ];
    const catalog = await catalogFor(
      { ANTHROPIC_AUTH_TOKEN: 'oauth-token', ANTHROPIC_BASE_URL: 'https://llm.example.com/anthropic/v1/' },
      (_request, attempt) => jsonResponse(pages[attempt - 1]),
    );

    const list = await catalog.list();

    expect(catalog.requests().map(({ url, headers }) => [url, headers['authorization']])).toEqual([
      ['https://llm.example.com/anthropic/v1/models?limit=1000', 'Bearer oauth-token'],
      ['https://llm.example.com/anthropic/v1/models?limit=1000&after_id=claude-sonnet-4-5', 'Bearer oauth-token'],
    ]);
    expect(list.data).toEqual([
      { id: 'anthropic/claude-haiku-4-5', object: 'model', created: 0, owned_by: 'anthropic' },
      { id: 'anthropic/claude-sonnet-4-5', object: 'model', created: 0, owned_by: 'anthropic' },
    ]);
  });
});

describe('a list of anthropic with an entry it does not expect', () => {
  it('keeps the entries it can read, and reads null or odd details as not reported', async () => {
    const page = {
      data: [
        { id: null, display_name: 'Nobody' },
        {
          id: 'claude-odd',
          display_name: null,
          created_at: 1_759_276_800,
          max_input_tokens: '200000',
          max_tokens: null,
        },
        ...anthropicModels.data.slice(0, 1),
      ],
      has_more: 'no',
      last_id: 7,
    };
    const catalog = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, () => jsonResponse(page));

    expect((await catalog.list()).data).toEqual([
      { id: 'anthropic/claude-odd', object: 'model', created: 0, owned_by: 'anthropic' },
      {
        id: 'anthropic/claude-sonnet-4-5-20250929',
        object: 'model',
        created: 1_759_104_000,
        owned_by: 'anthropic',
        name: 'Claude Sonnet 4.5',
        context_window: 200_000,
        max_tokens: 64_000,
      },
    ]);
  });
});
