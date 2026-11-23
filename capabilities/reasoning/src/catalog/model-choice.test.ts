import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicModels } from '../provider-testing/model-lists.ts';
import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { catalogFor } from '../testing/catalog-harness.ts';
import { modelChoiceOf } from './model-choice.ts';
import type { ModelEntry } from './model-list.ts';

async function anthropicAccess() {
  return (await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, () => jsonResponse(anthropicModels))).access;
}

function listing(data: readonly ModelEntry[]) {
  return {
    list: () =>
      Effect.succeed({
        object: 'list' as const,
        data,
        catalog_status: 'complete' as const,
        narrowed: false,
        listed_at: '2026-11-22T10:00:00.000Z',
      }),
    contextWindowOf: () => Effect.undefined,
  };
}

const anyOfBedrock: ModelEntry = { id: 'bedrock/*', object: 'model', created: 0, owned_by: 'bedrock', pattern: true };

const sonnet: ModelEntry = { id: 'anthropic/claude-sonnet-4-5', object: 'model', created: 0, owned_by: 'anthropic' };

describe('the choice of a model, as list_models and the check a run makes answer it', () => {
  it.each([
    ['a model by its id', [sonnet], true],
    ['only an id that stands for any model of its provider', [anyOfBedrock], false],
    ['no model at all', [], false],
  ] as const)('lists one to choose where list_models lists %s', async (_case, data, lists) => {
    const { resolution } = await anthropicAccess();

    expect(
      await Effect.runPromise(modelChoiceOf(Effect.succeed({ catalog: listing(data), resolution })).listsAModel),
    ).toBe(lists);
  });

  it('refuses a model a run would not be let call, in the words of that check, and nothing it would', async () => {
    const choice = modelChoiceOf(Effect.succeed(await anthropicAccess()));

    expect(await Effect.runPromise(choice.refusalOf('anthropic/claude-sonnet-4-5'))).toBeUndefined();
    expect(await Effect.runPromise(choice.refusalOf('nowhere/model'))).toEqual(expect.any(String));
    expect(await Effect.runPromise(choice.listsAModel)).toBe(true);
  });
});
