import { Effect } from 'effect';

import { modelSources } from '../listing/model-sources.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import { withCertificateFailures } from '../providers/outbound-fetch.ts';
import { secretScrubber } from '../settings/message-exposure.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import type { ProviderStatus } from '../settings/provider-status.ts';
import { catalogListing, type ModelCatalog } from './catalog-listing.ts';
import { listingCache } from './listing-cache.ts';

export function modelCatalogOf(
  settings: ModelSettings,
  status: ProviderStatus,
  options: ModelAccessOptions & Required<Pick<ModelAccessOptions, 'fetch'>>,
): ModelCatalog {
  return catalogListing({
    sources: modelSources(settings, status, withCertificateFailures(options.fetch)),
    providers: status.configured,
    aliases: settings.aliases,
    allowed: settings.allowed,
    cache: listingCache(),
    reports: {
      scrub: secretScrubber(settings),
      report: options.reportProviderMessage ?? (() => Effect.void),
      reportHint: options.reportOperatorHint ?? (() => Effect.void),
    },
  });
}
