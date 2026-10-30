import { Config, type Redacted } from 'effect';

import {
  anySet,
  baseUrlOf,
  bothProblems,
  configured,
  labelProblems,
  optionalSecret,
  optionalText,
  problem,
  unconfigured,
  urlProblems,
  type Availability,
  type Reading,
} from './setting-values.ts';

type AnthropicCredential =
  | { readonly type: 'api_key'; readonly key: Redacted.Redacted }
  | { readonly type: 'auth_token'; readonly token: Redacted.Redacted };

export interface AnthropicSettings {
  readonly credential: AnthropicCredential;
  readonly base_url: string | null;
}

type OpenAiApi = 'responses' | 'chat_completions';

export interface OpenAiSettings {
  readonly api_key: Redacted.Redacted;
  readonly base_url: string | null;
  readonly api: OpenAiApi;
}

export interface GoogleSettings {
  readonly api_key: Redacted.Redacted;
}

export interface BedrockSettings {
  readonly region: string;
  readonly bearer_token: Redacted.Redacted | null;
  readonly endpoint: string | null;
}

type AzureEndpoint = { readonly resource_name: string } | { readonly base_url: string };

export interface AzureSettings {
  readonly endpoint: AzureEndpoint;
  readonly api_version: string | null;
  readonly api_key: Redacted.Redacted | null;
}

export interface VertexSettings {
  readonly project: string;
  readonly location: string;
}

interface AnthropicSource {
  readonly api_key: Redacted.Redacted | undefined;
  readonly auth_token: Redacted.Redacted | undefined;
  readonly base_url: string | undefined;
}

interface OpenAiSource {
  readonly api_key: Redacted.Redacted | undefined;
  readonly base_url: string | undefined;
  readonly api: string | undefined;
}

interface GoogleSource {
  readonly api_key: Redacted.Redacted | undefined;
}

interface BedrockSource {
  readonly region: string | undefined;
  readonly bearer_token: Redacted.Redacted | undefined;
  readonly runtime_endpoint: string | undefined;
  readonly endpoint: string | undefined;
}

interface AzureSource {
  readonly resource_name: string | undefined;
  readonly base_url: string | undefined;
  readonly api_version: string | undefined;
  readonly api_key: Redacted.Redacted | undefined;
}

interface VertexSource {
  readonly project: string | undefined;
  readonly location: string | undefined;
}

const openAiApis: ReadonlySet<string> = new Set(['responses', 'chat_completions']);

export const anthropicSource: Config.Config<AnthropicSource> = Config.all({
  api_key: optionalSecret('ANTHROPIC_API_KEY'),
  auth_token: optionalSecret('ANTHROPIC_AUTH_TOKEN'),
  base_url: optionalText('ANTHROPIC_BASE_URL'),
});

function anthropicCredential({ api_key, auth_token }: AnthropicSource): AnthropicCredential | undefined {
  if (api_key !== undefined) {
    return { type: 'api_key', key: api_key };
  }
  return auth_token === undefined ? undefined : { type: 'auth_token', token: auth_token };
}

export function anthropicReading(source: AnthropicSource): Reading<AnthropicSettings> {
  const credential = anthropicCredential(source);
  const both = source.api_key !== undefined && source.auth_token !== undefined;
  return {
    problems: [
      ...bothProblems('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', both),
      ...urlProblems('ANTHROPIC_BASE_URL', source.base_url),
    ],
    availability:
      credential === undefined
        ? unconfigured(['ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN'], anySet(source.base_url))
        : configured({ credential, base_url: baseUrlOf(source.base_url) }),
  };
}

export const openAiSource: Config.Config<OpenAiSource> = Config.all({
  api_key: optionalSecret('OPENAI_API_KEY'),
  base_url: optionalText('OPENAI_BASE_URL'),
  api: optionalText('OPENAI_API'),
});

function isOpenAiApi(api: string): api is OpenAiApi {
  return openAiApis.has(api);
}

export function openAiReading(source: OpenAiSource): Reading<OpenAiSettings> {
  const api = source.api ?? 'responses';
  const known = isOpenAiApi(api);
  return {
    problems: [
      ...urlProblems('OPENAI_BASE_URL', source.base_url),
      ...(known ? [] : problem('OPENAI_API', 'Expected responses or chat_completions')),
    ],
    availability:
      source.api_key === undefined
        ? unconfigured(['OPENAI_API_KEY'], anySet(source.base_url, source.api))
        : configured({ api_key: source.api_key, base_url: baseUrlOf(source.base_url), api: known ? api : 'responses' }),
  };
}

export const googleSource: Config.Config<GoogleSource> = Config.all({
  api_key: optionalSecret('GOOGLE_GENERATIVE_AI_API_KEY'),
});

export function googleReading({ api_key }: GoogleSource): Reading<GoogleSettings> {
  return {
    problems: [],
    availability:
      api_key === undefined ? unconfigured(['GOOGLE_GENERATIVE_AI_API_KEY'], false) : configured({ api_key }),
  };
}

export const bedrockSource: Config.Config<BedrockSource> = Config.all({
  region: optionalText('AWS_REGION'),
  bearer_token: optionalSecret('AWS_BEARER_TOKEN_BEDROCK'),
  runtime_endpoint: optionalText('AWS_ENDPOINT_URL_BEDROCK_RUNTIME'),
  endpoint: optionalText('AWS_ENDPOINT_URL'),
});

export function bedrockReading(source: BedrockSource): Reading<BedrockSettings> {
  const availability: Availability<BedrockSettings> =
    source.region === undefined
      ? unconfigured(['AWS_REGION'], anySet(source.bearer_token, source.runtime_endpoint))
      : configured({
          region: source.region,
          bearer_token: source.bearer_token ?? null,
          endpoint: source.runtime_endpoint ?? source.endpoint ?? null,
        });
  return {
    problems: [
      ...labelProblems('AWS_REGION', source.region),
      ...urlProblems('AWS_ENDPOINT_URL_BEDROCK_RUNTIME', source.runtime_endpoint),
      ...urlProblems('AWS_ENDPOINT_URL', source.endpoint),
    ],
    availability,
  };
}

export const azureSource: Config.Config<AzureSource> = Config.all({
  resource_name: optionalText('AZURE_RESOURCE_NAME'),
  base_url: optionalText('AZURE_BASE_URL'),
  api_version: optionalText('AZURE_API_VERSION'),
  api_key: optionalSecret('AZURE_API_KEY'),
});

function azureEndpoint({ resource_name, base_url }: AzureSource): AzureEndpoint | undefined {
  if (resource_name !== undefined) {
    return { resource_name };
  }
  return base_url === undefined ? undefined : { base_url };
}

export function azureReading(source: AzureSource): Reading<AzureSettings> {
  const endpoint = azureEndpoint(source);
  const both = source.resource_name !== undefined && source.base_url !== undefined;
  return {
    problems: [
      ...bothProblems('AZURE_RESOURCE_NAME', 'AZURE_BASE_URL', both),
      ...labelProblems('AZURE_RESOURCE_NAME', source.resource_name),
      ...urlProblems('AZURE_BASE_URL', source.base_url),
    ],
    availability:
      endpoint === undefined
        ? unconfigured(['AZURE_RESOURCE_NAME or AZURE_BASE_URL'], anySet(source.api_key, source.api_version))
        : configured({ endpoint, api_version: source.api_version ?? null, api_key: source.api_key ?? null }),
  };
}

export const vertexSource: Config.Config<VertexSource> = Config.all({
  project: optionalText('GOOGLE_VERTEX_PROJECT'),
  location: optionalText('GOOGLE_VERTEX_LOCATION'),
});

export function vertexReading({ project, location }: VertexSource): Reading<VertexSettings> {
  const missing = [
    ...(project === undefined ? ['GOOGLE_VERTEX_PROJECT'] : []),
    ...(location === undefined ? ['GOOGLE_VERTEX_LOCATION'] : []),
  ];
  return {
    problems: labelProblems('GOOGLE_VERTEX_LOCATION', location),
    availability:
      project === undefined || location === undefined
        ? unconfigured(missing, anySet(project, location))
        : configured({ project, location }),
  };
}

export const providerVariables: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'AWS_REGION',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ENDPOINT_URL_BEDROCK_RUNTIME',
  'AWS_ENDPOINT_URL',
  'AZURE_RESOURCE_NAME',
  'AZURE_BASE_URL',
  'AZURE_API_VERSION',
  'AZURE_API_KEY',
  'GOOGLE_VERTEX_PROJECT',
  'GOOGLE_VERTEX_LOCATION',
];
