import { proxySettingsOf } from '@on.auto/outbound';
import { Effect, Layer } from 'effect';

import { LanguageModel } from '../model/language-model.ts';
import { readModelSettings, type ModelSettingsInvalid } from '../settings/model-settings.ts';
import type { Environment } from '../settings/setting-values.ts';
import type { ModelAccessOptions } from './model-access-options.ts';
import { makeModelAccess } from './model-access.ts';

export function languageModelLayer(
  environment: Environment,
  options: ModelAccessOptions = {},
): Layer.Layer<LanguageModel, ModelSettingsInvalid> {
  return Layer.effect(
    LanguageModel,
    readModelSettings(environment).pipe(
      Effect.flatMap((settings) => makeModelAccess(settings, { proxy: proxySettingsOf(environment), ...options })),
      Effect.map(({ languageModel }) => languageModel),
    ),
  );
}
