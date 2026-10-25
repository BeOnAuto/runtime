import type { Fetch } from '../providers/sdk-model.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import type { Availability } from '../settings/setting-values.ts';
import { anthropicListing } from './anthropic-listing.ts';
import { declaredModels, declaredSources, type DeclaredSource } from './declared-models.ts';
import { gatewayListing } from './gateway-listing.ts';
import { googleListing } from './google-listing.ts';
import type { ListedSource, ProviderListing } from './listing-request.ts';
import { openAiListing } from './openai-listing.ts';

export type ModelSource = ListedSource | DeclaredSource;

function listedFrom<S>(
  provider: string,
  availability: Availability<S>,
  listing: (settings: S) => ProviderListing,
): readonly ListedSource[] {
  return availability.configured ? [{ kind: 'listed', provider, fallback: [], ...listing(availability.settings) }] : [];
}

export function modelSources(settings: ModelSettings, status: ProviderStatus, fetch: Fetch): readonly ModelSource[] {
  return [
    ...listedFrom('anthropic', settings.anthropic, (anthropic) => anthropicListing(anthropic, fetch)),
    ...listedFrom('openai', settings.openai, (openai) => openAiListing(openai, fetch)),
    ...listedFrom('google', settings.google, (google) => googleListing(google, fetch)),
    ...declaredSources(settings, status),
    ...settings.gateways.map((gateway): ListedSource => ({
      kind: 'listed',
      provider: gateway.name,
      fallback: declaredModels(settings, gateway.name),
      ...gatewayListing(gateway, fetch),
    })),
  ];
}
