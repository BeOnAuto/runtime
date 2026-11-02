import { Redacted } from 'effect';

import { gatewayHeaders, gatewayUrl } from '../listing/gateway-listing.ts';
import { endpointUrl } from '../listing/listing-request.ts';
import { defaultBaseUrls } from '../providers/direct-providers.ts';
import type { ModelSettings } from '../settings/model-settings.ts';
import type { TranscriptionEndpoint } from './transcription.ts';
import type { VoiceModel } from './voice-settings.ts';

const transcriptionPath = '/audio/transcriptions';

export function endpointOf(
  { reference, provider, model }: VoiceModel,
  settings: ModelSettings,
): TranscriptionEndpoint | null {
  if (provider === 'openai') {
    return settings.openai.configured
      ? {
          provider,
          reference,
          model,
          url: endpointUrl(settings.openai.settings.base_url ?? defaultBaseUrls.openai, transcriptionPath).toString(),
          headers: { authorization: `Bearer ${Redacted.value(settings.openai.settings.api_key)}` },
          costHeader: null,
        }
      : null;
  }
  const gateway = settings.gateways.find(({ name }) => name === provider);
  return gateway === undefined
    ? null
    : {
        provider,
        reference,
        model,
        url: gatewayUrl(gateway, transcriptionPath),
        headers: gatewayHeaders(gateway),
        costHeader: gateway.cost_header,
      };
}
