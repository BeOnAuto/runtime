import { Effect, Redacted, Schema } from 'effect';

import { defaultBaseUrls } from '../providers/direct-providers.ts';
import type { Fetch } from '../providers/sdk-model.ts';
import type { OpenAiSettings } from '../settings/provider-settings.ts';
import { listedModels } from './listed-model.ts';
import { decodedAs, endpointUrl, listingJson, wellFormedEntries, type ProviderListing } from './listing-request.ts';

const openAiList = decodedAs(Schema.Struct({ data: Schema.Array(Schema.Unknown) }));

const openAiModels = wellFormedEntries(
  Schema.Struct({ id: Schema.String, created: Schema.optionalKey(Schema.Unknown) }),
);

const notForConversation: readonly RegExp[] = [
  /^ft:/u,
  /embedding/u,
  /^(?:whisper|tts)-|-tts(?:-|$)|transcribe/u,
  /audio/u,
  /^(?:dall-e|gpt-image|chatgpt-image)|-image(?:-|$)/u,
  /^sora/u,
  /moderation/u,
  /realtime/u,
  /^(?:babbage|davinci)-/u,
];

function isForConversation(id: string): boolean {
  return !notForConversation.some((pattern: Readonly<RegExp>) => pattern.test(id));
}

export function openAiListing(settings: OpenAiSettings, fetch: Fetch): ProviderListing {
  const apiKey = Redacted.value(settings.api_key);
  const url = endpointUrl(settings.base_url ?? defaultBaseUrls.openai, '/models').toString();
  return {
    read: listingJson({ fetch, url, headers: { authorization: `Bearer ${apiKey}` } }).pipe(
      Effect.flatMap(openAiList),
      Effect.map(({ data }) =>
        listedModels(
          'openai',
          openAiModels(data).filter(({ id }) => isForConversation(id)),
        ),
      ),
    ),
  };
}
