import type { FetchLike } from '@modelcontextprotocol/client';
import { DateTime, Option, Redacted, Schema } from 'effect';

const unnamedTokenType = 'Bearer';

const tokenFields = {
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_at: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
  token_type: Schema.String,
};

const KeptTokensSchema = Schema.Struct({
  ...tokenFields,
  connection_key: Schema.optionalKey(Schema.String),
  resources: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type KeptTokens = typeof KeptTokensSchema.Type;

const TimeSchema = Schema.String.check(
  Schema.makeFilter((text: string) => Number.isFinite(Date.parse(text)) || 'Expected a time in ISO 8601'),
);

export const HandedTokensSchema = Schema.Struct({
  ...tokenFields,
  expires_at: Schema.optionalKey(TimeSchema),
  token_type: Schema.optionalKey(Schema.String),
});

export type HandedTokens = typeof HandedTokensSchema.Type;

const AnsweredTokensSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
  scope: Schema.optionalKey(Schema.String),
  token_type: Schema.String,
});

export type AnsweredTokens = typeof AnsweredTokensSchema.Type;

const KeptValueSchema = Schema.fromJsonString(KeptTokensSchema);

const decodeValue = Schema.decodeUnknownOption(KeptValueSchema);

const encodeValue = Schema.encodeSync(KeptValueSchema);

export const answeredTokensOf = Schema.decodeUnknownSync(AnsweredTokensSchema);

const millisOfASecond = 1000;

export interface TokenHolding {
  readonly holder: string;
  readonly hold: (source: string, token: string) => void;
}

export function keptTokensIn(value: Redacted.Redacted): Option.Option<KeptTokens> {
  return decodeValue(Redacted.value(value));
}

export function keptValueOf(tokens: KeptTokens): Redacted.Redacted {
  return Redacted.make(encodeValue(tokens));
}

function expiryOf(nowMillis: number, expiresIn: number | undefined): string | undefined {
  return expiresIn === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(DateTime.make(nowMillis + expiresIn * millisOfASecond), DateTime.formatIso));
}

function recordOf(resources: readonly string[]): Pick<KeptTokens, 'resources'> {
  return resources.length === 0 ? {} : { resources };
}

export function keptOf(
  answered: AnsweredTokens,
  scope: string | undefined,
  nowMillis: number,
  resources: readonly string[],
): KeptTokens {
  const { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType } = answered;
  const expiresAt = expiryOf(nowMillis, answered.expires_in);
  return {
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    ...(scope === undefined ? {} : { scope }),
    token_type: tokenType,
    ...recordOf(resources),
  };
}

export function keptHandedOf(
  handed: HandedTokens,
  scope: string | undefined,
  key: string,
  resources: readonly string[],
): KeptTokens {
  const {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: tokenType,
  } = handed;
  return {
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    ...(scope === undefined ? {} : { scope }),
    token_type: tokenType ?? unnamedTokenType,
    connection_key: key,
    ...recordOf(resources),
  };
}

export function heldAmongSecrets(tokens: KeptTokens, { holder, hold }: TokenHolding): void {
  hold(`${holder} access token`, tokens.access_token);
  if (tokens.refresh_token !== undefined) {
    hold(`${holder} refresh token`, tokens.refresh_token);
  }
  if (tokens.connection_key !== undefined) {
    hold(`${holder} connection key`, tokens.connection_key);
  }
}

const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

type Answer = Readonly<Record<string, unknown>>;

function namesNoTokenType(answer: Answer): boolean {
  return Object.hasOwn(answer, 'access_token') && !Object.hasOwn(answer, 'token_type');
}

function typedAnswerOf(response: Readonly<Response>, answer: Answer): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...answer, token_type: unnamedTokenType }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readAsBearer(response: Response): Promise<Response> {
  if (!response.ok) {
    return response;
  }
  const untyped = Option.filter(decodeAnswer(await response.clone().text()), namesNoTokenType);
  return Option.match(untyped, { onNone: () => response, onSome: (answer) => typedAnswerOf(response, answer) });
}

export function tokenAnswersReadAsBearer(fetch: FetchLike): FetchLike {
  return async (...[address, init]: readonly [unknown, unknown?]) =>
    readAsBearer(await fetch(String(address), Object.assign({}, init)));
}

export interface AskedResources {
  readonly asked: readonly string[];
  readonly recorded: readonly string[];
}

const noneAsked: AskedResources = { asked: [], recorded: [] };

const noResourceRecorded: readonly string[] = [];

const resourceParameter = 'resource';

export function resourcesAskedOf(
  serverResource: string | undefined,
  requestOrigins: readonly string[] = [],
): AskedResources {
  return serverResource === undefined
    ? noneAsked
    : { asked: [...new Set([serverResource, ...requestOrigins])], recorded: requestOrigins };
}

export function resourcesRecordedBy({
  resources = noResourceRecorded,
}: Pick<KeptTokens, 'resources'>): readonly string[] {
  return resources;
}

export function originsAskedAgainOf(
  previous: Pick<KeptTokens, 'resources'>,
  requestOrigins: readonly string[] = [],
): readonly string[] {
  const recorded = resourcesRecordedBy(previous);
  return requestOrigins.filter((origin) => recorded.includes(origin));
}

function resourcesBesideTheServersOf({ asked }: AskedResources): readonly string[] {
  return asked.slice(1);
}

export function askedBesideTheServers(url: Readonly<URL>, resources: AskedResources): void {
  for (const resource of resourcesBesideTheServersOf(resources)) {
    url.searchParams.append(resourceParameter, resource);
  }
}

export function sentWithResourcesBeside(fetch: FetchLike, resources: AskedResources): FetchLike {
  const beside = resourcesBesideTheServersOf(resources);
  if (beside.length === 0) {
    return fetch;
  }
  return async (...[address, init]: readonly [unknown, unknown?]) => {
    const form = new URLSearchParams(await new Request(String(address), Object.assign({}, init)).text());
    for (const resource of beside) {
      form.append(resourceParameter, resource);
    }
    return fetch(String(address), Object.assign({}, init, { body: form }));
  };
}
