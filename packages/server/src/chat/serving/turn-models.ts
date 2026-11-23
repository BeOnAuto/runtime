import type { Wait, Waits } from '@on.auto/chat';
import type { ModelAccess } from '@on.auto/reasoning';
import { Effect, Result } from 'effect';

import type { ModelLimits, TurnModels } from '../turn/turn-model.ts';

export interface ModelsOfTheServer {
  readonly models: Effect.Effect<Pick<ModelAccess, 'resolution' | 'catalog' | 'languageModel'>>;
  readonly modelChoice: { readonly refusalOf: (model: string) => Effect.Effect<string | undefined> };
}

export const wallClockWaits: Waits = (ms): Wait => {
  const pending: { timer: ReturnType<typeof setTimeout> | undefined } = { timer: undefined };
  const elapsed = new Promise<void>((resolve) => {
    pending.timer = setTimeout(resolve, ms);
  });
  return {
    elapsed,
    stop: () => {
      clearTimeout(pending.timer);
    },
  };
};

export function turnModelsOf({ models, modelChoice }: ModelsOfTheServer): TurnModels {
  const limitsOf = (model: string): Effect.Effect<ModelLimits> =>
    Effect.flatMap(models, ({ resolution, catalog }) => {
      const target = resolution(model);
      if (Result.isFailure(target)) {
        return Effect.succeed({});
      }
      const { provider, resolved } = target.success;
      return Effect.map(catalog.list(provider), ({ data }) => {
        const entry = data.find(({ id }) => id === resolved);
        return { contextWindow: entry?.context_window, mostOutputTokens: entry?.max_tokens };
      });
    });
  return {
    refusalOf: (model) => Effect.runPromise(modelChoice.refusalOf(model)),
    limitsOf: (model) => Effect.runPromise(limitsOf(model)),
    generate: () => (request, signal) => {
      const generated = Effect.flatMap(models, ({ languageModel }) => languageModel.generate(request));
      const answered = Effect.bindTo(generated, 'answered');
      const settled = Effect.flip(Effect.bindTo(Effect.flip(answered), 'failed')).pipe(Effect.catch(Effect.succeed));
      return Effect.runPromise(settled, signal === undefined ? undefined : { signal });
    },
  };
}
