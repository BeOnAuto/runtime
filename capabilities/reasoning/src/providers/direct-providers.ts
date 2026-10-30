import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Redacted } from 'effect';

import type { GatewaySettings } from '../settings/gateway-settings.ts';
import type { AnthropicSettings, GoogleSettings, OpenAiSettings } from '../settings/provider-settings.ts';
import type { Fetch, ModelFactory } from './sdk-model.ts';

export const defaultBaseUrls = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
} as const;

export function anthropicModels(settings: AnthropicSettings, fetch: Fetch): ModelFactory {
  const { credential } = settings;
  const provider = createAnthropic({
    ...(credential.type === 'api_key'
      ? { apiKey: Redacted.value(credential.key) }
      : { authToken: Redacted.value(credential.token) }),
    baseURL: settings.base_url ?? defaultBaseUrls.anthropic,
    fetch,
  });
  return (modelId) => provider.languageModel(modelId);
}

export function openAiModels(settings: OpenAiSettings, fetch: Fetch): ModelFactory {
  const provider = createOpenAI({
    apiKey: Redacted.value(settings.api_key),
    baseURL: settings.base_url ?? defaultBaseUrls.openai,
    fetch,
  });
  return settings.api === 'chat_completions'
    ? (modelId) => provider.chat(modelId)
    : (modelId) => provider.responses(modelId);
}

export function googleModels(settings: GoogleSettings, fetch: Fetch): ModelFactory {
  const provider = createGoogle({ apiKey: Redacted.value(settings.api_key), fetch });
  return (modelId) => provider.languageModel(modelId);
}

export function revealed(values: ReadonlyMap<string, Redacted.Redacted>): Record<string, string> {
  return Object.fromEntries(
    [...values].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

export function gatewayModels(settings: GatewaySettings, fetch: Fetch): ModelFactory {
  const provider = createOpenAICompatible({
    name: settings.name,
    baseURL: settings.base_url,
    ...(settings.api_key === null ? {} : { apiKey: Redacted.value(settings.api_key) }),
    headers: revealed(settings.headers),
    queryParams: revealed(settings.query_params),
    supportsStructuredOutputs: settings.structured_outputs,
    includeUsage: settings.include_usage,
    fetch,
  });
  return (modelId) => provider.languageModel(modelId);
}
