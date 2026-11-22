import { Effect, Result } from 'effect';

import type { ModelAccess } from '../providers/model-access.ts';

interface ModelChoice {
  readonly refusalOf: (model: string) => Effect.Effect<string | undefined>;
}

export function modelChoiceOf(models: Effect.Effect<Pick<ModelAccess, 'resolution'>>): ModelChoice {
  return {
    refusalOf: (model) =>
      Effect.map(models, ({ resolution }) => {
        const resolved = resolution(model);
        return Result.isFailure(resolved) ? resolved.failure.detail : undefined;
      }),
  };
}
