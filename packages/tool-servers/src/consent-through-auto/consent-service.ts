import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect, Option, Redacted, Schema } from 'effect';

import { HandedTokensSchema, type HandedTokens, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import { ClientIdSchema, type ServiceClient } from '../consent/client-sources.ts';

export interface ConsentReturn {
  readonly kind: 'hosted' | 'loopback';
  readonly base: string;
}

export interface ServiceRequesting {
  readonly fetch: FetchLike;
  readonly url: string;
  readonly requestMs: number;
  readonly requestTimeout: (ms: number) => AbortSignal;
}

export interface ServiceStartAsked {
  readonly issuer: string;
  readonly scope: string | undefined;
  readonly parameters: Readonly<Record<string, string>> | undefined;
  readonly resource: string | undefined;
  readonly returnTo: ConsentReturn;
  readonly challenge: string;
}

interface ServiceRefreshAsked {
  readonly issuer: string;
  readonly refreshToken: string;
  readonly connectionKey: string;
  readonly resource: string | undefined;
}

interface ServiceRevokeAsked {
  readonly issuer: string;
  readonly tokens: KeptTokens;
  readonly connectionKey: string;
}

const ClientsSchema = Schema.Struct({
  clients: Schema.Array(Schema.Struct({ issuer: Schema.String, client_id: ClientIdSchema })),
});

const GivenSchema = Schema.String.check(Schema.isMinLength(1));

const ServiceStartedSchema = Schema.Struct({ state: GivenSchema, url: GivenSchema, expires_at: GivenSchema });

const DescribedSchema = Schema.Struct({
  issuer: Schema.String,
  return: Schema.Struct({ kind: Schema.Literals(['hosted', 'loopback']), base: Schema.optionalKey(GivenSchema) }),
});

const RedeemedSchema = Schema.Struct({ handle: GivenSchema, expires_at: GivenSchema });

const HandedOffSchema = Schema.Struct({
  client_id: ClientIdSchema,
  tokens: HandedTokensSchema,
  connection_key: GivenSchema,
});

const RefreshedSchema = Schema.Struct({ tokens: HandedTokensSchema });

const ProblemSchema = Schema.Struct({ refused: Schema.String, vendor_status: Schema.optionalKey(Schema.Int) });

type ServiceStarted = typeof ServiceStartedSchema.Type;

type DescribedConsent = typeof DescribedSchema.Type;

type Redeemed = typeof RedeemedSchema.Type;

type HandedOff = typeof HandedOffSchema.Type;

type Unanswered = { readonly refused: 'unanswered' };

type StartRefusal = Unanswered | { readonly refused: 'start_refused' };

type RedeemRefusal = Unanswered | { readonly refused: 'code' | 'no_consent' | 'redeemed' };

type HandoffRefusal = Unanswered | { readonly refused: 'code' };

type RefreshRefusal = Unanswered | { readonly refused: 'invalid_grant' } | { readonly refused: 'unknown_key' };

type RevokeRefusal =
  | Unanswered
  | { readonly refused: 'unknown_key' }
  | { readonly refused: 'not_revoked'; readonly status: number };

export interface ConsentServiceCalls {
  readonly clients: Effect.Effect<readonly ServiceClient[], Unanswered>;
  readonly start: (asked: ServiceStartAsked) => Effect.Effect<ServiceStarted, StartRefusal>;
  readonly describe: (
    state: string,
    session: Redacted.Redacted,
  ) => Effect.Effect<DescribedConsent | undefined, Unanswered>;
  readonly redeem: (
    state: string,
    session: Redacted.Redacted,
    returned: { readonly code: string; readonly iss?: string },
  ) => Effect.Effect<Redeemed, RedeemRefusal>;
  readonly takeHandoff: (handle: string, verifier: Redacted.Redacted) => Effect.Effect<HandedOff, HandoffRefusal>;
  readonly refresh: (asked: ServiceRefreshAsked) => Effect.Effect<HandedTokens, RefreshRefusal>;
  readonly revoke: (asked: ServiceRevokeAsked) => Effect.Effect<void, RevokeRefusal>;
}

interface Answered {
  readonly status: number;
  readonly text: string;
}

interface Sending {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
  readonly session?: Redacted.Redacted;
}

const unanswered: Unanswered = { refused: 'unanswered' };

const challengeMethod = 'S256';

const status = {
  ok: 200,
  created: 201,
  refused: 400,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  badGateway: 502,
} as const;

const decodeProblem = Schema.decodeUnknownOption(Schema.fromJsonString(ProblemSchema));

const decodeClients = Schema.decodeUnknownOption(Schema.fromJsonString(ClientsSchema));

const decodeStarted = Schema.decodeUnknownOption(Schema.fromJsonString(ServiceStartedSchema));

const decodeDescribed = Schema.decodeUnknownOption(Schema.fromJsonString(DescribedSchema));

const decodeRedeemed = Schema.decodeUnknownOption(Schema.fromJsonString(RedeemedSchema));

const decodeHandedOff = Schema.decodeUnknownOption(Schema.fromJsonString(HandedOffSchema));

const decodeRefreshed = Schema.decodeUnknownOption(Schema.fromJsonString(RefreshedSchema));

function headersOf({ body, session }: Sending): Readonly<Record<string, string>> {
  return {
    accept: 'application/json',
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(session === undefined ? {} : { authorization: `Bearer ${Redacted.value(session)}` }),
  };
}

function sent(requesting: ServiceRequesting, sending: Sending): Effect.Effect<Answered, Unanswered> {
  const { fetch, url, requestMs, requestTimeout } = requesting;
  return Effect.tryPromise({
    try: async () => {
      const answer = await fetch(new URL(sending.path, url).href, {
        method: sending.method,
        headers: headersOf(sending),
        redirect: 'manual',
        signal: requestTimeout(requestMs),
        ...(sending.body === undefined ? {} : { body: JSON.stringify(sending.body) }),
      });
      return { status: answer.status, text: await answer.text() };
    },
    catch: () => unanswered,
  });
}

function decodedAs<A>(decode: (text: string) => Option.Option<A>, { text }: Answered): Effect.Effect<A, Unanswered> {
  return Option.match(decode(text), {
    onNone: () => Effect.fail(unanswered),
    onSome: (decoded) => Effect.succeed(decoded),
  });
}

function problemOf({ text }: Answered): typeof ProblemSchema.Type | undefined {
  return Option.getOrUndefined(decodeProblem(text));
}

function isRefused(answered: Answered, atStatus: number, refused: string): boolean {
  return answered.status === atStatus && problemOf(answered)?.refused === refused;
}

function pathOf(...parts: readonly string[]): string {
  return `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
}

function started(answered: Answered): Effect.Effect<ServiceStarted, StartRefusal> {
  if (answered.status === status.refused) {
    return Effect.fail({ refused: 'start_refused' });
  }
  return answered.status === status.created ? decodedAs(decodeStarted, answered) : Effect.fail(unanswered);
}

function described(answered: Answered): Effect.Effect<DescribedConsent | undefined, Unanswered> {
  if (answered.status === status.notFound) {
    return Effect.undefined;
  }
  return answered.status === status.ok ? decodedAs(decodeDescribed, answered) : Effect.fail(unanswered);
}

const redeemRefusals: ReadonlyMap<number, RedeemRefusal> = new Map([
  [status.notFound, { refused: 'no_consent' }],
  [status.conflict, { refused: 'redeemed' }],
]);

function redeemed(answered: Answered): Effect.Effect<Redeemed, RedeemRefusal> {
  if (answered.status === status.ok) {
    return decodedAs(decodeRedeemed, answered);
  }
  if (isRefused(answered, status.refused, 'code_refused')) {
    return Effect.fail({ refused: 'code' });
  }
  return Effect.fail(redeemRefusals.get(answered.status) ?? unanswered);
}

function handedOff(answered: Answered): Effect.Effect<HandedOff, HandoffRefusal> {
  if (answered.status === status.ok) {
    return decodedAs(decodeHandedOff, answered);
  }
  const isRefusedHandle =
    answered.status === status.notFound || isRefused(answered, status.forbidden, 'wrong_verifier');
  return Effect.fail(isRefusedHandle ? { refused: 'code' } : unanswered);
}

function refreshRefusalOf(answered: Answered): RefreshRefusal {
  if (isRefused(answered, status.refused, 'invalid_grant')) {
    return { refused: 'invalid_grant' };
  }
  return isRefused(answered, status.forbidden, 'unknown_key') ? { refused: 'unknown_key' } : unanswered;
}

function refreshed(answered: Answered): Effect.Effect<HandedTokens, RefreshRefusal> {
  if (answered.status === status.ok) {
    return Effect.map(decodedAs(decodeRefreshed, answered), ({ tokens }) => tokens);
  }
  return Effect.fail(refreshRefusalOf(answered));
}

function revokeRefusalOf(answered: Answered): RevokeRefusal {
  if (isRefused(answered, status.forbidden, 'unknown_key')) {
    return { refused: 'unknown_key' };
  }
  const vendorStatus = isRefused(answered, status.badGateway, 'not_revoked')
    ? problemOf(answered)?.vendor_status
    : undefined;
  return vendorStatus === undefined ? unanswered : { refused: 'not_revoked', status: vendorStatus };
}

function revoked(answered: Answered): Effect.Effect<void, RevokeRefusal> {
  return answered.status >= status.ok && answered.status < 300 ? Effect.void : Effect.fail(revokeRefusalOf(answered));
}

function startBodyOf({ issuer, scope, parameters, resource, returnTo, challenge }: ServiceStartAsked) {
  return { issuer, scope, parameters, resource, return: returnTo, challenge, challenge_method: challengeMethod };
}

function revokeBodyOf({ issuer, tokens, connectionKey }: ServiceRevokeAsked) {
  const { access_token: accessToken, refresh_token: refreshToken } = tokens;
  return { issuer, access_token: accessToken, refresh_token: refreshToken, connection_key: connectionKey };
}

function refreshBodyOf({ issuer, refreshToken, connectionKey, resource }: ServiceRefreshAsked) {
  return { issuer, refresh_token: refreshToken, connection_key: connectionKey, resource };
}

export function consentServiceOf(requesting: ServiceRequesting): ConsentServiceCalls {
  const send = (sending: Sending) => sent(requesting, sending);
  return {
    clients: Effect.flatMap(send({ path: '/clients', method: 'GET' }), (answered) =>
      answered.status === status.ok
        ? Effect.map(decodedAs(decodeClients, answered), ({ clients }) => clients)
        : Effect.fail(unanswered),
    ),
    start: (asked) => Effect.flatMap(send({ path: '/consents', method: 'POST', body: startBodyOf(asked) }), started),
    describe: (state, session) =>
      Effect.flatMap(send({ path: pathOf('consents', state), method: 'GET', session }), described),
    redeem: (state, session, returned) =>
      Effect.flatMap(
        send({ path: pathOf('consents', state, 'redeem'), method: 'POST', session, body: returned }),
        redeemed,
      ),
    takeHandoff: (handle, verifier) =>
      Effect.flatMap(
        send({ path: pathOf('handoffs', handle), method: 'POST', body: { verifier: Redacted.value(verifier) } }),
        handedOff,
      ),
    refresh: (asked) =>
      Effect.flatMap(send({ path: '/tokens/refresh', method: 'POST', body: refreshBodyOf(asked) }), refreshed),
    revoke: (asked) =>
      Effect.flatMap(send({ path: '/tokens/revoke', method: 'POST', body: revokeBodyOf(asked) }), revoked),
  };
}
