import { Effect, Redacted, Schema } from 'effect';

import { revealed } from '../providers/direct-providers.ts';
import type { Fetch } from '../providers/sdk-model.ts';
import type { GatewaySettings } from '../settings/gateway-settings.ts';
import { listedModels, type ListedModel } from './listed-model.ts';
import { decodedAs, endpointUrl, listingJson, wellFormedEntries, type ProviderListing } from './listing-request.ts';

const gatewayList = decodedAs(Schema.Struct({ data: Schema.Array(Schema.Unknown) }));

const gatewayEntries = wellFormedEntries(
  Schema.Struct({
    id: Schema.String,
    created: Schema.optionalKey(Schema.Unknown),
    name: Schema.optionalKey(Schema.Unknown),
    context_window: Schema.optionalKey(Schema.Unknown),
    max_tokens: Schema.optionalKey(Schema.Unknown),
    type: Schema.optionalKey(Schema.Unknown),
  }),
);

type GatewayEntry = ReturnType<typeof gatewayEntries>[number];

function listUrl({ base_url: baseUrl, query_params: queryParams }: GatewaySettings): string {
  const url = endpointUrl(baseUrl, '/models');
  if (queryParams.size > 0) {
    url.search = new URLSearchParams(revealed(queryParams)).toString();
  }
  return url.toString();
}

function headersOf({ api_key: apiKey, headers }: GatewaySettings): Readonly<Record<string, string>> {
  return {
    ...(apiKey === null ? {} : { Authorization: `Bearer ${Redacted.value(apiKey)}` }),
    ...revealed(headers),
  };
}

function isLanguageModel({ type }: GatewayEntry): boolean {
  return typeof type !== 'string' || type === 'language';
}

function modelsOf(gateway: string, entries: readonly unknown[]): readonly ListedModel[] {
  return listedModels(
    gateway,
    gatewayEntries(entries).filter((entry) => isLanguageModel(entry)),
  );
}

export function gatewayListing(settings: GatewaySettings, fetch: Fetch): ProviderListing {
  const { name } = settings;
  return {
    read: listingJson({ fetch, url: listUrl(settings), headers: headersOf(settings) }).pipe(
      Effect.flatMap(gatewayList),
      Effect.map(({ data }) => modelsOf(name, data)),
    ),
  };
}
