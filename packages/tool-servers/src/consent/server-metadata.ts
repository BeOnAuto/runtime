import {
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
  resourceUrlFromServerUrl,
  type AuthorizationServerMetadata,
  type FetchLike,
} from '@modelcontextprotocol/client';
import type { Reaches } from '@on.auto/outbound';
import { Effect, Schema } from 'effect';

import { isPinnableUrl } from '../settings/checked.ts';
import { isSameIssuer } from './client-sources.ts';
import type { ConsentAsked, ConsentRefusal, ConsentServer, ConsentWay, Refused } from './consent-client.ts';
import { discoveryRefusalOf, refusalOf } from './consent-failures.ts';
import { withOfflineAccess } from './scopes.ts';

const endpointFields = {
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  revocation_endpoint: Schema.optional(Schema.String),
  registration_endpoint: Schema.optionalKey(Schema.String),
  client_id_metadata_document_supported: Schema.optionalKey(Schema.Boolean),
  authorization_response_iss_parameter_supported: Schema.optionalKey(Schema.Boolean),
};

const Strings = Schema.Array(Schema.String);

const MutableStrings = Schema.mutable(Strings);

const AuthorizationServerSchema = Schema.Struct({
  ...endpointFields,
  response_types_supported: Strings,
  code_challenge_methods_supported: Schema.optionalKey(Strings),
  token_endpoint_auth_methods_supported: Schema.optionalKey(Strings),
  revocation_endpoint_auth_methods_supported: Schema.optionalKey(Strings),
  scopes_supported: Schema.optionalKey(Strings),
});

const LibraryMetadataSchema = Schema.Struct({
  ...endpointFields,
  response_types_supported: MutableStrings,
  code_challenge_methods_supported: Schema.optionalKey(MutableStrings),
  token_endpoint_auth_methods_supported: Schema.optionalKey(MutableStrings),
});

export type AuthorizationServer = typeof AuthorizationServerSchema.Type;

const ProtectedResourceSchema = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.optionalKey(Strings),
  scopes_supported: Schema.optionalKey(Strings),
});

export type ProtectedResource = typeof ProtectedResourceSchema.Type;

export interface Challenge {
  readonly resourceMetadata: string | undefined;
  readonly scope: string | undefined;
}

export interface ServerMetadata {
  readonly server: AuthorizationServer;
  readonly resource: string | undefined;
}

const authorizationServerOf = Schema.decodeUnknownSync(AuthorizationServerSchema);

const protectedResourceOfAnswer = Schema.decodeUnknownSync(ProtectedResourceSchema);

const discoveredServerOfAnswer = Schema.decodeUnknownSync(Schema.UndefinedOr(AuthorizationServerSchema));

export const libraryMetadataOf: (server: AuthorizationServer) => AuthorizationServerMetadata =
  Schema.decodeUnknownSync(LibraryMetadataSchema);

const codeResponse = 'code';

const challengeMethod = 'S256';

const notFound = 404;

const unauthorized = 401;

const pingOpeningNoSession = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
};

export const noMetadata: Refused<'no_metadata'> = { refused: 'no_metadata' };

const noChallenge: Refused<'no_challenge'> = { refused: 'no_challenge' };

function isResourceOf(url: string, resource: string): boolean {
  return checkResourceAllowed({ requestedResource: resourceUrlFromServerUrl(url), configuredResource: resource });
}

type ResourceRefusal = Refused<'another_resource' | 'host' | 'unanswered'>;

async function challengeIn(answer: Readonly<Response>): Promise<Challenge | undefined> {
  await answer.body?.cancel();
  if (answer.status !== unauthorized) {
    return undefined;
  }
  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(answer);
  return { resourceMetadata: resourceMetadataUrl?.href, scope };
}

export function challengeOf(
  url: string,
  fetch: FetchLike,
): Effect.Effect<Challenge | undefined, Refused<'host' | 'unanswered'>> {
  return Effect.tryPromise({
    try: async () => challengeIn(await fetch(url, pingOpeningNoSession)),
    catch: refusalOf,
  });
}

function readAt(
  url: string,
  fetch: FetchLike,
  resourceMetadataUrl?: string,
): Effect.Effect<ProtectedResource | undefined, ResourceRefusal> {
  const answered = { status: 0 };
  const observing: FetchLike = async (...[address, init]: readonly [unknown, unknown?]) => {
    answered.status = 0;
    const response = await fetch(String(address), Object.assign({}, init));
    answered.status = response.status;
    return response;
  };
  const discovered = Effect.tryPromise({
    try: () =>
      discoverOAuthProtectedResourceMetadata(
        url,
        resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl },
        observing,
      ),
    catch: (error) => error,
  }).pipe(Effect.map(protectedResourceOfAnswer));
  return Effect.matchEffect(discovered, {
    onSuccess: (metadata) =>
      isResourceOf(url, metadata.resource)
        ? Effect.succeed(metadata)
        : Effect.fail<Refused<'another_resource'>>({ refused: 'another_resource', named: metadata.resource }),
    onFailure: (error) => (answered.status === notFound ? Effect.undefined : Effect.fail(refusalOf(error))),
  });
}

function followedMetadataOf(challenge: Challenge | undefined): string | undefined {
  const named = challenge?.resourceMetadata;
  return named !== undefined && isPinnableUrl(named) ? named : undefined;
}

export function protectedResourceOf(
  url: string,
  fetch: FetchLike,
  challenge: Challenge | undefined,
): Effect.Effect<ProtectedResource | undefined, ResourceRefusal> {
  const followed = followedMetadataOf(challenge);
  const atTheChallenge = followed === undefined ? Effect.undefined : readAt(url, fetch, followed);
  return Effect.flatMap(atTheChallenge, (resource) =>
    resource === undefined ? readAt(url, fetch) : Effect.succeed(resource),
  );
}

function discoveredResourceOf(
  server: ConsentServer,
  fetch: FetchLike,
): Effect.Effect<ProtectedResource | undefined, ResourceRefusal> {
  return server.type === 'openapi'
    ? Effect.undefined
    : Effect.flatMap(challengeOf(server.url, fetch), (challenge) => protectedResourceOf(server.url, fetch, challenge));
}

function builtServerOf({
  issuer,
  authorization_endpoint: authorizationEndpoint,
  token_endpoint: tokenEndpoint,
  revocation_endpoint: revocationEndpoint,
}: ConsentWay): AuthorizationServer | undefined {
  return authorizationEndpoint === undefined || tokenEndpoint === undefined
    ? undefined
    : authorizationServerOf({
        issuer,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        revocation_endpoint: revocationEndpoint,
        response_types_supported: [codeResponse],
        code_challenge_methods_supported: [challengeMethod],
      });
}

export function discoveredServerOf(
  issuer: string,
  fetch: FetchLike,
): Effect.Effect<AuthorizationServer, Refused<'another_issuer' | 'no_metadata' | 'host' | 'unanswered'>> {
  return Effect.tryPromise({
    try: () => discoverAuthorizationServerMetadata(issuer, { fetchFn: fetch }),
    catch: discoveryRefusalOf,
  }).pipe(
    Effect.map(discoveredServerOfAnswer),
    Effect.flatMap((discovered) => (discovered === undefined ? Effect.fail(noMetadata) : Effect.succeed(discovered))),
  );
}

function takesTheCodeWithItsChallenge(server: AuthorizationServer): boolean {
  return (
    server.response_types_supported.includes(codeResponse) &&
    server.code_challenge_methods_supported?.includes(challengeMethod) === true
  );
}

function refusedHostOf(server: AuthorizationServer, reaches: Reaches): string | undefined {
  const endpoints = [
    server.authorization_endpoint,
    server.token_endpoint,
    server.revocation_endpoint,
    server.registration_endpoint,
  ];
  return endpoints
    .flatMap((endpoint) => (endpoint === undefined ? [] : [reaches(endpoint)]))
    .find((rule) => rule !== undefined);
}

export function checkedServer(
  server: AuthorizationServer,
  reaches: Reaches,
): Effect.Effect<AuthorizationServer, Refused<'no_challenge' | 'host'>> {
  if (!takesTheCodeWithItsChallenge(server)) {
    return Effect.fail(noChallenge);
  }
  const rule = refusedHostOf(server, reaches);
  return rule === undefined ? Effect.succeed(server) : Effect.fail({ refused: 'host', rule });
}

export function serverMetadataOf(
  { server, way, reaches }: ConsentAsked,
  fetch: FetchLike,
): Effect.Effect<ServerMetadata, ConsentRefusal> {
  return Effect.gen(function* () {
    const protectedResource = yield* discoveredResourceOf(server, fetch);
    const named = protectedResource?.authorization_servers ?? [way.issuer];
    if (!named.some((issuer) => isSameIssuer(issuer, way.issuer))) {
      return yield* Effect.fail<ConsentRefusal>({ refused: 'another_issuer', named: named.join(', '), by: 'server' });
    }
    const resolved = builtServerOf(way) ?? (yield* discoveredServerOf(way.issuer, fetch));
    return { server: yield* checkedServer(resolved, reaches), resource: protectedResource?.resource };
  });
}

export function scopeAskedOf({ scope }: ConsentWay, server: AuthorizationServer): string | undefined {
  return scope === undefined ? undefined : withOfflineAccess(scope, server.scopes_supported);
}
