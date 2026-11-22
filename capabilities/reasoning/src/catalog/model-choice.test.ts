import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicModels } from '../provider-testing/model-lists.ts';
import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { catalogFor } from '../testing/catalog-harness.ts';
import { modelChoiceOf } from './model-choice.ts';

async function anthropicAccess() {
  return (await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, () => jsonResponse(anthropicModels))).access;
}

describe('the choice of a model, as the check a run makes answers it', () => {
  it('refuses a model a run would not be let call, in the words of that check, and nothing it would', async () => {
    const choice = modelChoiceOf(Effect.succeed(await anthropicAccess()));

    expect(await Effect.runPromise(choice.refusalOf('anthropic/claude-sonnet-4-5'))).toBeUndefined();
    expect(await Effect.runPromise(choice.refusalOf('nowhere/model'))).toEqual(expect.any(String));
  });
});
