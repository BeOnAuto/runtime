import { awsCredentialChainOf, type ProxySettings } from '@on.auto/outbound';

import type { ModelSettings } from '../settings/model-settings.ts';
import type { AzureSettings, BedrockSettings, VertexSettings } from '../settings/provider-settings.ts';
import type { Availability } from '../settings/setting-values.ts';
import { azureModels, bedrockAnthropicModels, bedrockModels, type AzureCredential } from './cloud-providers.ts';
import {
  guarded,
  type AccessTokenSource,
  type AwsCredentials,
  type AwsCredentialSource,
  type CredentialSources,
} from './credential-sources.ts';
import { anthropicModels, gatewayModels, googleModels, openAiModels } from './direct-providers.ts';
import { withCertificateFailures } from './outbound-fetch.ts';
import { installSdkGlobals } from './sdk-globals.ts';
import type { Fetch, ModelFactory } from './sdk-model.ts';

export interface FactorySources {
  readonly fetch: Fetch;
  readonly credentials: CredentialSources;
  readonly azureTokens: AccessTokenSource | undefined;
  readonly proxy: ProxySettings;
}

type Entry = readonly [string, ModelFactory];

function entriesFor<S>(availability: Availability<S>, make: (settings: S) => readonly Entry[]): readonly Entry[] {
  return availability.configured ? make(availability.settings) : [];
}

function azureCredentialOf(
  settings: AzureSettings,
  tokens: AccessTokenSource | undefined,
): AzureCredential | undefined {
  if (settings.api_key !== null) {
    return { api_key: settings.api_key };
  }
  return tokens === undefined ? undefined : { tokens: guarded(tokens) };
}

function azureEntries(azure: AzureSettings, tokens: AccessTokenSource | undefined, fetch: Fetch): readonly Entry[] {
  const credential = azureCredentialOf(azure, tokens);
  return credential === undefined ? [] : [['azure', azureModels(azure, credential, fetch)]];
}

async function bedrockEntries(
  bedrock: Availability<BedrockSettings>,
  given: AwsCredentialSource | undefined,
  proxy: ProxySettings,
  fetch: Fetch,
): Promise<readonly Entry[]> {
  if (!bedrock.configured) {
    return [];
  }
  const aws = guarded<AwsCredentials>(given ?? (await awsCredentialChainOf(proxy)));
  return [
    ['bedrock', bedrockModels(bedrock.settings, aws, fetch)],
    ['bedrock-anthropic', bedrockAnthropicModels(bedrock.settings, aws, fetch)],
  ];
}

async function vertexEntries(
  vertex: Availability<VertexSettings>,
  google: AccessTokenSource | undefined,
  fetch: Fetch,
): Promise<readonly Entry[]> {
  if (!vertex.configured) {
    return [];
  }
  const { googleCredentialChain, vertexAnthropicModels, vertexModels } = await import('./vertex-providers.ts');
  const tokens = guarded(google ?? googleCredentialChain(vertex.settings.project));
  return [
    ['vertex', vertexModels(vertex.settings, tokens, fetch)],
    ['vertex-anthropic', vertexAnthropicModels(vertex.settings, tokens, fetch)],
  ];
}

export async function modelFactories(
  settings: ModelSettings,
  sources: FactorySources,
): Promise<ReadonlyMap<string, ModelFactory>> {
  installSdkGlobals();
  const fetch = withCertificateFailures(sources.fetch);
  const [bedrock, vertex] = await Promise.all([
    bedrockEntries(settings.bedrock, sources.credentials.aws, sources.proxy, fetch),
    vertexEntries(settings.vertex, sources.credentials.google, fetch),
  ]);
  return new Map([
    ...entriesFor(settings.anthropic, (anthropic) => [['anthropic', anthropicModels(anthropic, fetch)]]),
    ...entriesFor(settings.openai, (openai) => [['openai', openAiModels(openai, fetch)]]),
    ...entriesFor(settings.google, (google) => [['google', googleModels(google, fetch)]]),
    ...bedrock,
    ...entriesFor(settings.azure, (azure) => azureEntries(azure, sources.azureTokens, fetch)),
    ...vertex,
    ...settings.gateways.map((gateway): Entry => [gateway.name, gatewayModels(gateway, fetch)]),
  ]);
}
