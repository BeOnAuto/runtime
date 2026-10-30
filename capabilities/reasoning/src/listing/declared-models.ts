import { providersDeclaringModels } from '../settings/catalog-settings.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import { listedModel, type ListedModel } from './listed-model.ts';

export interface DeclaredSource {
  readonly kind: 'declared';
  readonly provider: string;
  readonly models: readonly ListedModel[];
}

export function declaredModels(settings: ModelSettings, provider: string): readonly ListedModel[] {
  return (settings.declared.get(provider) ?? []).map((id) => listedModel(`${provider}/${id}`, {}));
}

export function declaredSources(settings: ModelSettings, status: ProviderStatus): readonly DeclaredSource[] {
  return providersDeclaringModels
    .filter((provider) => status.configured.includes(provider))
    .map((provider) => ({ kind: 'declared', provider, models: declaredModels(settings, provider) }));
}
