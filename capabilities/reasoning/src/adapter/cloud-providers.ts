import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAmazonBedrockAnthropic } from '@ai-sdk/amazon-bedrock/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { Redacted } from 'effect';

import type { AzureSettings, BedrockSettings } from '../settings/provider-settings.ts';
import type { AccessTokenSource, AwsCredentialSource } from './credential-sources.ts';
import type { Fetch, ModelFactory } from './sdk-model.ts';

function bedrockOptions(settings: BedrockSettings, credentials: AwsCredentialSource, fetch: Fetch) {
  return {
    region: settings.region,
    apiKey: settings.bearer_token === null ? '' : Redacted.value(settings.bearer_token),
    credentialProvider: credentials,
    ...(settings.endpoint === null ? {} : { baseURL: settings.endpoint }),
    fetch,
  };
}

export function bedrockModels(settings: BedrockSettings, credentials: AwsCredentialSource, fetch: Fetch): ModelFactory {
  const provider = createAmazonBedrock(bedrockOptions(settings, credentials, fetch));
  return (modelId) => provider.languageModel(modelId);
}

export function bedrockAnthropicModels(
  settings: BedrockSettings,
  credentials: AwsCredentialSource,
  fetch: Fetch,
): ModelFactory {
  const provider = createAmazonBedrockAnthropic(bedrockOptions(settings, credentials, fetch));
  return (modelId) => provider.languageModel(modelId);
}

export type AzureCredential = { readonly api_key: Redacted.Redacted } | { readonly tokens: AccessTokenSource };

export function azureModels(settings: AzureSettings, credential: AzureCredential, fetch: Fetch): ModelFactory {
  const { endpoint, api_version } = settings;
  const provider = createAzure({
    ...('resource_name' in endpoint ? { resourceName: endpoint.resource_name } : { baseURL: endpoint.base_url }),
    ...(api_version === null ? {} : { apiVersion: api_version }),
    ...('api_key' in credential
      ? { apiKey: Redacted.value(credential.api_key) }
      : { tokenProvider: credential.tokens }),
    fetch,
  });
  return (modelId) => provider.languageModel(modelId);
}
