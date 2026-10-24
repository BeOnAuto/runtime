import { Effect, Predicate, Redacted, Schema } from 'effect';

import type { Fetch } from '../providers/sdk-model.ts';
import type { GoogleSettings } from '../settings/provider-settings.ts';
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

const GooglePageSchema = Schema.Struct({
  models: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  nextPageToken: Schema.optionalKey(Schema.Unknown),
});

type GooglePage = typeof GooglePageSchema.Type;

const googlePage = decodedAs(GooglePageSchema);

const googleModels = wellFormedEntries(
  Schema.Struct({
    name: Schema.String,
    displayName: Schema.optionalKey(Schema.Unknown),
    inputTokenLimit: Schema.optionalKey(Schema.Unknown),
    outputTokenLimit: Schema.optionalKey(Schema.Unknown),
    supportedGenerationMethods: Schema.optionalKey(Schema.Unknown),
  }),
);

const isMethodList = Schema.is(Schema.Array(Schema.String));

const geminiApiUrl = 'https://generativelanguage.googleapis.com/v1beta';

const mostPerPage = 1000;

const resourcePrefix = 'models/';

function pageUrl(cursor: string | undefined): string {
  const url = endpointUrl(geminiApiUrl, '/models');
  url.searchParams.set('pageSize', String(mostPerPage));
  if (cursor !== undefined) {
    url.searchParams.set('pageToken', cursor);
  }
  return url.toString();
}

function modelIdOf(name: string): string {
  return name.startsWith(resourcePrefix) ? name.slice(resourcePrefix.length) : name;
}

function generatesContent(methods: unknown): boolean {
  return isMethodList(methods) && methods.includes('generateContent');
}

function nextOf(nextPageToken: unknown): string | undefined {
  return Predicate.isString(nextPageToken) && nextPageToken !== '' ? nextPageToken : undefined;
}

function pageOf({ models, nextPageToken }: GooglePage): ListingPage {
  return {
    models: listedModels(
      'google',
      googleModels(models ?? [])
        .filter(({ supportedGenerationMethods }) => generatesContent(supportedGenerationMethods))
        .map(({ name, displayName, inputTokenLimit, outputTokenLimit }) => ({
          id: modelIdOf(name),
          name: displayName,
          context_window: inputTokenLimit,
          max_tokens: outputTokenLimit,
        })),
    ),
    next: nextOf(nextPageToken),
  };
}

export function googleListing(settings: GoogleSettings, fetch: Fetch): ProviderListing {
  const apiKey = Redacted.value(settings.api_key);
  const headers = { 'x-goog-api-key': apiKey };
  return {
    read: everyPage((cursor) =>
      listingJson({ fetch, url: pageUrl(cursor), headers }).pipe(Effect.flatMap(googlePage), Effect.map(pageOf)),
    ),
  };
}
