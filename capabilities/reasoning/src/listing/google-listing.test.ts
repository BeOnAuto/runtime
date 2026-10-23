import { describe, expect, it } from 'vitest';

import { geminiModels, geminiModelsAfter } from '../provider-testing/model-lists.ts';
import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { catalogFor } from '../testing/catalog-harness.ts';

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
