import { Effect, Predicate, Redacted, Schema } from 'effect';

import { defaultBaseUrls } from '../providers/direct-providers.ts';
import type { Fetch } from '../providers/sdk-model.ts';
import type { AnthropicSettings } from '../settings/provider-settings.ts';
import { listedModels } from './listed-model.ts';
import {
  decodedAs,
  endpointUrl,
  everyPage,
  listingJson,
  wellFormedEntries,
  type ListingPage,
  type ProviderListing,
} from './listing-request.ts';

const AnthropicPageSchema = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  has_more: Schema.optionalKey(Schema.Unknown),
  last_id: Schema.optionalKey(Schema.Unknown),
});

type AnthropicPage = typeof AnthropicPageSchema.Type;

const anthropicPage = decodedAs(AnthropicPageSchema);

const anthropicModels = wellFormedEntries(
  Schema.Struct({
    id: Schema.String,
    display_name: Schema.optionalKey(Schema.Unknown),
    created_at: Schema.optionalKey(Schema.Unknown),
    max_input_tokens: Schema.optionalKey(Schema.Unknown),
    max_tokens: Schema.optionalKey(Schema.Unknown),
  }),
);

const mostPerPage = 1000;

function headersOf({ credential }: AnthropicSettings): Readonly<Record<string, string>> {
  return {
    'anthropic-version': '2023-06-01',
    ...(credential.type === 'api_key'
      ? { 'x-api-key': Redacted.value(credential.key) }
      : { authorization: `Bearer ${Redacted.value(credential.token)}` }),
  };
}

function pageUrl(baseUrl: string, cursor: string | undefined): string {
  const url = endpointUrl(baseUrl, '/models');
  url.searchParams.set('limit', String(mostPerPage));
  if (cursor !== undefined) {
    url.searchParams.set('after_id', cursor);
  }
  return url.toString();
}

function nextOf({ has_more: hasMore, last_id: lastId }: AnthropicPage): string | undefined {
  return hasMore === true && Predicate.isString(lastId) ? lastId : undefined;
}

function secondsSince(createdAt: unknown): number {
  return Predicate.isString(createdAt) ? Date.parse(createdAt) / 1000 : 0;
}

function pageOf(page: AnthropicPage): ListingPage {
  return {
    models: listedModels(
      'anthropic',
      anthropicModels(page.data).map(({ id, display_name, created_at, max_input_tokens, max_tokens }) => ({
        id,
        name: display_name,
        created: secondsSince(created_at),
        context_window: max_input_tokens,
        max_tokens,
      })),
    ),
    next: nextOf(page),
  };
}

export function anthropicListing(settings: AnthropicSettings, fetch: Fetch): ProviderListing {
  const baseUrl = settings.base_url ?? defaultBaseUrls.anthropic;
  const headers = headersOf(settings);
  return {
    read: everyPage((cursor) =>
      listingJson({ fetch, url: pageUrl(baseUrl, cursor), headers }).pipe(
        Effect.flatMap(anthropicPage),
        Effect.map(pageOf),
      ),
    ),
  };
}
