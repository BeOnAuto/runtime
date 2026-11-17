import { describe, expect, it } from 'vitest';

import { anthropicModels, geminiModels, geminiModelsAfter, openAiModels } from '../provider-testing/model-lists.ts';
import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { catalogFor, idsIn } from '../testing/catalog-harness.ts';

describe('the models of openai', () => {
  it('are read with the key, keeping only those a conversation can use by their documented names', async () => {
    const catalog = await catalogFor({ OPENAI_API_KEY: 'sk-openai-key' }, () => jsonResponse(openAiModels));

    const list = await catalog.list();

    expect(catalog.requests()).toMatchObject([
      { url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer sk-openai-key' } },
    ]);
    expect(idsIn(list)).toEqual(['openai/gpt-4.1', 'openai/gpt-5', 'openai/gpt-5-mini', 'openai/o3']);
    expect(list.data[1]).toEqual({ id: 'openai/gpt-5', object: 'model', created: 1_754_425_777, owned_by: 'openai' });
  });

  it('are read from the base URL that is set', async () => {
    const catalog = await catalogFor(
      { OPENAI_API_KEY: 'sk-openai-key', OPENAI_BASE_URL: 'https://llm.example.com/openai/v1' },
      () => jsonResponse({ object: 'list', data: [{ id: 'gpt-5', object: 'model', owned_by: 'system' }] }),
    );

    const list = await catalog.list();

    expect(catalog.requests()[0]?.url).toBe('https://llm.example.com/openai/v1/models');
    expect(list.data).toEqual([{ id: 'openai/gpt-5', object: 'model', created: 0, owned_by: 'openai' }]);
  });
});

describe('a list of openai with an entry it does not expect', () => {
  it('keeps the entries it can read, and reads a created time that is not a number as 0', async () => {
    const answer = {
      object: 'list',
      data: [
        { id: null, object: 'model' },
        { id: 'gpt-5', created: '2025-08-07' },
        'gpt-4.1',
        { id: 'o3', created: 1_744_225_308 },
      ],
    };
    const catalog = await catalogFor({ OPENAI_API_KEY: 'sk-openai-key' }, () => jsonResponse(answer));

    expect((await catalog.list()).data).toEqual([
      { id: 'openai/gpt-5', object: 'model', created: 0, owned_by: 'openai' },
      { id: 'openai/o3', object: 'model', created: 1_744_225_308, owned_by: 'openai' },
    ]);
  });
});

describe('the models of google', () => {
  it('are read page by page with the key in its header, keeping those that generate content', async () => {
    const pages = [geminiModels, geminiModelsAfter];
    const catalog = await catalogFor({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-google-key' }, (_request, attempt) =>
      jsonResponse(pages[attempt - 1]),
    );

    const list = await catalog.list();

    expect(catalog.requests().map(({ url, headers }) => [url, headers['x-goog-api-key']])).toEqual([
      ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', 'AIza-google-key'],
      [
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=Chdtb2RlbHMvZ2VtbWEtMy0yN2ItaXQ%3D',
        'AIza-google-key',
      ],
    ]);
    expect(list.data).toEqual([
      {
        id: 'google/gemini-2.5-flash',
        object: 'model',
        created: 0,
        owned_by: 'google',
        name: 'Gemini 2.5 Flash',
        context_window: 1_048_576,
        max_tokens: 65_536,
      },
      {
        id: 'google/gemma-3-27b-it',
        object: 'model',
        created: 0,
        owned_by: 'google',
        name: 'Gemma 3 27B',
        context_window: 131_072,
        max_tokens: 8192,
      },
    ]);
  });
});

describe('a list of models of google with unusual entries', () => {
  it('takes a name without its resource prefix as it is, and an empty page token as the last page', async () => {
    const page = {
      models: [
        { name: 'gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/aqa' },
      ],
      nextPageToken: '',
    };
    const catalog = await catalogFor({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-google-key' }, () => jsonResponse(page));

    const list = await catalog.list();

    expect(catalog.requests()).toHaveLength(1);
    expect(list.data).toEqual([{ id: 'google/gemini-flash-latest', object: 'model', created: 0, owned_by: 'google' }]);
  });

  it('are none when a page has no models', async () => {
    const catalog = await catalogFor({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-google-key' }, () => jsonResponse({}));

    expect(await catalog.list()).toMatchObject({ data: [], catalog_status: 'complete' });
  });
});

describe('a list of google with an entry it does not expect', () => {
  it('keeps the entries it can read, and reads a limit that is not a number as not reported', async () => {
    const page = {
      models: [
        { name: null, supportedGenerationMethods: ['generateContent'] },
        {
          name: 'models/gemini-odd',
          inputTokenLimit: '1048576',
          displayName: null,
          supportedGenerationMethods: ['generateContent'],
        },
        { name: 'models/gemini-methodless', supportedGenerationMethods: 'generateContent' },
        geminiModels.models[0],
      ],
      nextPageToken: 42,
    };
    const catalog = await catalogFor({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-google-key' }, () => jsonResponse(page));

    expect((await catalog.list()).data).toEqual([
      {
        id: 'google/gemini-2.5-flash',
        object: 'model',
        created: 0,
        owned_by: 'google',
        name: 'Gemini 2.5 Flash',
        context_window: 1_048_576,
        max_tokens: 65_536,
      },
      { id: 'google/gemini-odd', object: 'model', created: 0, owned_by: 'google' },
    ]);
    expect(catalog.requests()).toHaveLength(1);
  });

  it('reads a page whose models are null as a page without models', async () => {
    const catalog = await catalogFor({ GOOGLE_GENERATIVE_AI_API_KEY: 'AIza-google-key' }, () =>
      jsonResponse({ models: null }),
    );

    expect(await catalog.list()).toMatchObject({ data: [], catalog_status: 'complete' });
  });
});

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
