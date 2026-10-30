import { describe, expect, it } from 'vitest';

import { openAiModels } from '../provider-testing/model-lists.ts';
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
