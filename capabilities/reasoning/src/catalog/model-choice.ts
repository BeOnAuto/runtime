import { Effect, Result } from 'effect';

import type { ModelAccess } from '../providers/model-access.ts';

interface ModelChoice {
  readonly listsAModel: Effect.Effect<boolean>;
  readonly refusalOf: (model: string) => Effect.Effect<string | undefined>;
}

export function modelChoiceOf(models: Effect.Effect<Pick<ModelAccess, 'catalog' | 'resolution'>>): ModelChoice {
  return {
    listsAModel: Effect.flatMap(models, ({ catalog }) =>
      Effect.map(catalog.list(), ({ data }) => data.some(({ pattern }) => pattern !== true)),
    ),
    refusalOf: (model) =>
      Effect.map(models, ({ resolution }) => {
        const resolved = resolution(model);
        return Result.isFailure(resolved) ? resolved.failure.detail : undefined;
      }),
  };
}
