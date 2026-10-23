import { Effect } from 'effect';

import { modelCatalogOf } from '../catalog/model-catalog.ts';
import type { LanguageModel } from '../model/language-model.ts';
import { offeredModels, type OfferedModels } from '../model/offered-models.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import { providerStatus, type ProviderStatus } from '../settings/provider-status.ts';
import { azureTokensFor, loadEntraIdentity } from './entra-id.ts';
import type { ModelAccessOptions } from './model-access-options.ts';
import { modelFactories } from './model-factories.ts';
import { resolvedLanguageModel } from './resolved-language-model.ts';

export interface ModelAccess {
  readonly languageModel: LanguageModel['Service'];
  readonly status: ProviderStatus;
  readonly offered: OfferedModels;
  readonly catalog: ReturnType<typeof modelCatalogOf>;
}

export const makeModelAccess = Effect.fnUntraced(function* (settings: ModelSettings, options: ModelAccessOptions = {}) {
  const credentials = options.credentials ?? {};
  const azureTokens = yield* azureTokensFor(
    settings.azure,
    credentials.azure,
    options.loadEntraIdentity ?? loadEntraIdentity,
  );
  const status = providerStatus(settings, { entraId: azureTokens !== undefined });
  const fetch = options.fetch ?? globalThis.fetch;
  const proxy = options.proxy ?? { enabled: false, environment: {} };
  const models = yield* Effect.promise(() => modelFactories(settings, { fetch, credentials, azureTokens, proxy }));
  const access: ModelAccess = {
    languageModel: resolvedLanguageModel(models, settings, status, options),
    status,
    offered: offeredModels(status.configured, settings.aliases, settings.allowed),
    catalog: modelCatalogOf(settings, status, { ...options, fetch }),
  };
  return access;
});
