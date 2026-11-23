import { ModelNotAllowed, TimedOut, type ModelAccess, type ModelCatalog, type ModelRequest } from '@on.auto/reasoning';
import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { turnModelsOf, wallClockWaits } from './turn-models.ts';

const unused = (): never => {
  throw new Error('unused');
};

const catalog: ModelCatalog = {
  list: () =>
    Effect.succeed({
      object: 'list',
      data: [
        {
          id: 'provider/model',
          object: 'model',
          created: 0,
          owned_by: 'provider',
          context_window: 64_000,
          max_tokens: 8_000,
        },
      ],
      catalog_status: 'complete',
      narrowed: false,
      listed_at: '',
    }),
  contextWindowOf: () => Effect.undefined,
};

const access = (refused: boolean): Effect.Effect<Pick<ModelAccess, 'resolution' | 'catalog' | 'languageModel'>> =>
  Effect.succeed({
    resolution: (model: string) =>
      refused
        ? Result.fail(new ModelNotAllowed({ detail: `${model} is not offered`, provider: 'provider' }))
        : Result.succeed({
            provider: 'provider',
            requested: model,
            resolved: model,
            model: unused,
            costHeader: null,
            takesSchemas: true,
          }),
    catalog,
    languageModel: {
      admit: () => Effect.void,
      generate: () => Effect.fail(new TimedOut({ detail: 'late', provider: 'provider', timeout_ms: 1 })),
    },
  });

const aRequest: ModelRequest = {
  model: 'provider/model',
  messages: [],
  output: { type: 'text' },
  settings: { max_output_tokens: 10 },
};

describe('the models a turn asks', () => {
  it('read what the chosen model takes, and nothing for a model the server does not resolve', async () => {
    const offered = turnModelsOf({
      models: access(false),
      modelChoice: { refusalOf: (): Effect.Effect<string | undefined> => Effect.undefined },
    });
    const refused = turnModelsOf({ models: access(true), modelChoice: { refusalOf: () => Effect.succeed('gone') } });

    expect([
      await offered.limitsOf('provider/model'),
      await offered.limitsOf('provider/other'),
      await refused.limitsOf('provider/model'),
      await refused.refusalOf('provider/model'),
      Object.keys(await offered.generate('provider/model')(aRequest, new AbortController().signal)),
      Object.keys(await offered.generate('provider/model')(aRequest)),
    ]).toEqual([
      { contextWindow: 64_000, mostOutputTokens: 8_000 },
      { contextWindow: undefined, mostOutputTokens: undefined },
      {},
      'gone',
      ['failed'],
      ['failed'],
    ]);
  });
});

describe('the wall clock of a turn', () => {
  it('waits until its time has passed, and no longer once stopped', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const waited = wallClockWaits(1_000);
    wallClockWaits(60_000).stop();
    await vi.advanceTimersByTimeAsync(1_000);
    await waited.elapsed;

    expect(vi.getTimerCount()).toBe(0);
  });
});
