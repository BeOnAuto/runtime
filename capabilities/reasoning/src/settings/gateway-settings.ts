import { decodedJsonSettingWith, strictly, withoutTrailingSlashes } from '@on.auto/config';
import { redactedValuesOf } from '@on.auto/tool-servers';
import { Effect, Redacted, Result, Schema } from 'effect';

import { allowedOptionProblems } from './allowed-provider-options.ts';
import {
  optionalSecret,
  problemAt,
  settingsFrom,
  urlProblems,
  type Environment,
  type SettingProblem,
} from './setting-values.ts';

export interface GatewaySettings {
  readonly name: string;
  readonly base_url: string;
  readonly api_key: Redacted.Redacted | null;
  readonly api_key_env: string | null;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly query_params: ReadonlyMap<string, Redacted.Redacted>;
  readonly structured_outputs: boolean;
  readonly include_usage: boolean;
  readonly expose_provider_messages: boolean;
  readonly allowed_provider_options: ReadonlySet<string>;
  readonly cost_header: string | null;
}

interface GatewayReading {
  readonly problems: readonly SettingProblem[];
  readonly gateways: readonly GatewaySettings[];
}

interface GatewayEntry {
  readonly name: string;
  readonly base_url: string;
  readonly api_key?: string;
  readonly api_key_env?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly structured_outputs?: boolean;
  readonly include_usage?: boolean;
  readonly expose_provider_messages?: boolean;
  readonly allowed_provider_options?: readonly string[];
  readonly cost_header?: string;
}

interface ReadGateway {
  readonly problems: readonly SettingProblem[];
  readonly gateway: GatewaySettings;
}

const builtInProviders: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'google',
  'bedrock',
  'bedrock-anthropic',
  'azure',
  'vertex',
  'vertex-anthropic',
]);

const setting = 'MODEL_GATEWAYS';

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

const gatewayName = /^[a-z][a-z0-9-]{0,31}$/u;

const gatewayFields = {
  name: Schema.String.annotate({
    description:
      'The provider prefix, such as gateway in gateway/llama-3.3-70b: 1 to 32 lowercase letters, digits and hyphens, starting with a letter, unique, and not a built-in prefix',
  }),
  base_url: Schema.String.annotate({
    description: 'The http or https URL that /chat/completions is appended to, such as https://gateway.example.com/v1',
  }),
  api_key: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'The key, sent as Authorization: Bearer <key>; in the configuration file a reference such as ${GATEWAY_API_KEY}',
    }),
  ),
  headers: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description:
        'Headers sent with every request, their values treated as secrets; in the configuration file a credential is a reference',
    }),
  ),
  query_params: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({
      description: 'Query parameters added to every request, their values treated as secrets',
    }),
  ),
  structured_outputs: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true when the endpoint accepts response_format json_schema; otherwise JSON is asked for as json_object and the schema is only checked here. Default false',
    }),
  ),
  include_usage: Schema.optionalKey(
    Schema.Boolean.annotate({ description: 'Asks for usage in streamed responses. Default false' }),
  ),
  expose_provider_messages: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "true when the gateway's error messages are safe to show to callers of a reasoning function. Default false",
    }),
  ),
  allowed_provider_options: Schema.optionalKey(
    Schema.Array(Schema.String).annotate({
      description:
        'The top-level request body fields a reasoning function may set for this gateway through provider_options, such as user and metadata. Default none',
    }),
  ),
  cost_header: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "A gateway entry names the header its gateway answers the call's cost in, in US dollars, or names none and no cost is kept. A run keeps the cost as cost_usd",
    }),
  ),
};

export const ModelGatewaysSchema = Schema.Array(Schema.Struct(gatewayFields));

const decodeGateways = Schema.decodeUnknownResult(
  Schema.Array(Schema.Struct({ ...gatewayFields, api_key_env: Schema.optionalKey(Schema.String) })),
  strictly,
);

function nameProblems(name: string, index: number, names: readonly string[]): readonly SettingProblem[] {
  if (!gatewayName.test(name)) {
    return problemAt(
      setting,
      `/${index}/name`,
      `Expected 1 to 32 lowercase letters, digits and hyphens, starting with a letter`,
    );
  }
  if (builtInProviders.has(name)) {
    return problemAt(setting, `/${index}/name`, `${name} is a built-in provider`);
  }
  return names.indexOf(name) < index ? problemAt(setting, `/${index}/name`, `${name} is used twice`) : [];
}

function costHeaderProblems(header: string | undefined, index: number): readonly SettingProblem[] {
  return header === undefined || headerName.test(header)
    ? []
    : problemAt(setting, `/${index}/cost_header`, 'Expected the name of an HTTP header');
}

const apiKeyOf = Effect.fnUntraced(function* (environment: Environment, name: string | undefined) {
  return name === undefined
    ? undefined
    : yield* optionalSecret(name).parse(settingsFrom(environment)).pipe(Effect.orDie);
});

function keyProblems(
  entry: GatewayEntry,
  index: number,
  named: Redacted.Redacted | undefined,
): readonly SettingProblem[] {
  if (entry.api_key !== undefined && entry.api_key_env !== undefined) {
    return problemAt(setting, `/${index}/api_key`, `Set api_key or api_key_env, not both`);
  }
  return entry.api_key_env !== undefined && named === undefined
    ? problemAt(setting, `/${index}/api_key_env`, `The variable it names is not set`)
    : [];
}

function switchesOf(entry: GatewayEntry) {
  return {
    structured_outputs: entry.structured_outputs ?? false,
    include_usage: entry.include_usage ?? false,
    expose_provider_messages: entry.expose_provider_messages ?? false,
    allowed_provider_options: new Set(entry.allowed_provider_options),
    cost_header: entry.cost_header?.toLowerCase() ?? null,
  };
}

const gatewayFrom = Effect.fnUntraced(function* (environment: Environment, entry: GatewayEntry, index: number) {
  const named = yield* apiKeyOf(environment, entry.api_key_env);
  const api_key = entry.api_key === undefined ? named : Redacted.make(entry.api_key);
  const read: ReadGateway = {
    problems: [
      ...urlProblems(setting, entry.base_url).map(({ detail }) => ({ setting, pointer: `/${index}/base_url`, detail })),
      ...keyProblems(entry, index, named),
      ...allowedOptionProblems(entry.allowed_provider_options ?? [], index),
      ...costHeaderProblems(entry.cost_header, index),
    ],
    gateway: {
      name: entry.name,
      base_url: withoutTrailingSlashes(entry.base_url),
      api_key: api_key ?? null,
      api_key_env: entry.api_key_env ?? null,
      headers: redactedValuesOf(entry.headers ?? {}),
      query_params: redactedValuesOf(entry.query_params ?? {}),
      ...switchesOf(entry),
    },
  };
  return read;
});

const entriesOf = (text: string | undefined): Result.Result<readonly GatewayEntry[], readonly SettingProblem[]> =>
  text === undefined ? Result.succeed([]) : decodedJsonSettingWith(setting, text, decodeGateways);

export const gatewayReading = Effect.fnUntraced(function* (environment: Environment, text: string | undefined) {
  const entries = entriesOf(text);
  if (Result.isFailure(entries)) {
    const failed: GatewayReading = { problems: entries.failure, gateways: [] };
    return failed;
  }
  const names = entries.success.map((entry) => entry.name);
  const read = yield* Effect.forEach(entries.success, (entry, index) => gatewayFrom(environment, entry, index));
  const reading: GatewayReading = {
    problems: [
      ...entries.success.flatMap((entry, index) => nameProblems(entry.name, index, names)),
      ...read.flatMap((gateway) => gateway.problems),
    ],
    gateways: read.map((gateway) => gateway.gateway),
  };
  return reading;
});
