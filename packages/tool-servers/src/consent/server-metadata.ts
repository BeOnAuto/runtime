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
import { discoveryRefusalOf, observedCalls, type CallRefusal } from './consent-failures.ts';
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

export interface Pinged {
  readonly takesNoToken: boolean;
  readonly challenge: Challenge;
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

const pingOpeningNoSession = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
};

const noMetadata: Refused<'no_metadata'> = { refused: 'no_metadata' };

const noChallenge: Refused<'no_challenge'> = { refused: 'no_challenge' };

export function handGivenUrlOf(server: ConsentServer): string | undefined {
  return server.type === 'mcp' && server.givenByHand === true ? server.url : undefined;
}

function isResourceOf(url: string, resource: string): boolean {
  return checkResourceAllowed({ requestedResource: resourceUrlFromServerUrl(url), configuredResource: resource });
}

type ResourceRefusal = Refused<'another_resource'> | CallRefusal;

export const answeredNotFound = (status: number): boolean => status === notFound;

async function pingedBy(answer: Readonly<Response>): Promise<Pinged> {
  await answer.body?.cancel();
  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(answer);
  return { takesNoToken: answer.ok, challenge: { resourceMetadata: resourceMetadataUrl?.href, scope } };
}

export function pingedAt(url: string, fetch: FetchLike): Effect.Effect<Pinged, CallRefusal> {
  const observed = observedCalls('ping', url, fetch);
  return Effect.tryPromise({
    try: async () => pingedBy(await observed.fetch(url, pingOpeningNoSession)),
    catch: observed.refusalOf,
  });
}

function resourceReadAt(
  url: string,
  fetch: FetchLike,
  unpublished: typeof answeredNotFound,
  resourceMetadataUrl?: string,
): Effect.Effect<ProtectedResource | undefined, ResourceRefusal> {
  const observed = observedCalls('resource_metadata', resourceMetadataUrl ?? url, fetch);
  const discovered = Effect.tryPromise({
    try: () =>
      discoverOAuthProtectedResourceMetadata(
        url,
        resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl },
        observed.fetch,
      ),
    catch: (error) => error,
  }).pipe(Effect.map(protectedResourceOfAnswer));
  return Effect.matchEffect(discovered, {
    onSuccess: (metadata) =>
      isResourceOf(url, metadata.resource)
        ? Effect.succeed(metadata)
        : Effect.fail<Refused<'another_resource'>>({ refused: 'another_resource', named: metadata.resource }),
    onFailure: (error) =>
      observed.answeredWith(unpublished) ? Effect.undefined : Effect.fail(observed.refusalOf(error)),
  });
}

function followedMetadataOf({ resourceMetadata }: Challenge): string | undefined {
  return resourceMetadata !== undefined && isPinnableUrl(resourceMetadata) ? resourceMetadata : undefined;
}

export function protectedResourceOf(
  url: string,
  fetch: FetchLike,
  challenge: Challenge,
  unpublishedAtTheWellKnownPaths: typeof answeredNotFound = answeredNotFound,
): Effect.Effect<ProtectedResource | undefined, ResourceRefusal> {
  const followed = followedMetadataOf(challenge);
  const atTheChallenge =
    followed === undefined
      ? Effect.undefined
      : resourceReadAt(url, fetch, answeredNotFound, followed).pipe(
          Effect.catch((refusal) => (refusal.refused === 'another_resource' ? Effect.fail(refusal) : Effect.undefined)),
        );
  return Effect.flatMap(atTheChallenge, (resource) =>
    resource === undefined ? resourceReadAt(url, fetch, unpublishedAtTheWellKnownPaths) : Effect.succeed(resource),
  );
}

function discoveredResourceOf(
  server: ConsentServer,
  fetch: FetchLike,
): Effect.Effect<ProtectedResource | undefined, ResourceRefusal> {
  return server.type === 'openapi'
    ? Effect.undefined
    : Effect.flatMap(pingedAt(server.url, fetch), ({ challenge }) => protectedResourceOf(server.url, fetch, challenge));
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
): Effect.Effect<AuthorizationServer, Refused<'another_issuer' | 'no_metadata'> | CallRefusal> {
  if (!isPinnableUrl(issuer)) {
    return Effect.fail(noMetadata);
  }
  const observed = observedCalls('authorization_server_metadata', issuer, fetch);
  return Effect.tryPromise({
    try: () => discoverAuthorizationServerMetadata(issuer, { fetchFn: observed.fetch }),
    catch: (error) => discoveryRefusalOf(error, observed),
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

function endpointsOf(server: AuthorizationServer): readonly string[] {
  const endpoints = [
    server.authorization_endpoint,
    server.token_endpoint,
    server.revocation_endpoint,
    server.registration_endpoint,
  ];
  return endpoints.filter((endpoint) => endpoint !== undefined);
}

const unanswered: Refused<'unanswered'> = { refused: 'unanswered' };

function refusedHostOf(
  server: AuthorizationServer,
  reaches: Reaches,
): Effect.Effect<string | undefined, Refused<'unanswered'>> {
  return Effect.tryPromise({
    try: async () => {
      const rules = await Promise.all(endpointsOf(server).map((endpoint) => Promise.resolve(reaches(endpoint))));
      return rules.find((rule) => rule !== undefined);
    },
    catch: () => unanswered,
  });
}

export function checkedServer(
  server: AuthorizationServer,
  reaches: Reaches,
): Effect.Effect<AuthorizationServer, Refused<'no_challenge' | 'unpinned_endpoint' | 'host' | 'unanswered'>> {
  if (!takesTheCodeWithItsChallenge(server)) {
    return Effect.fail(noChallenge);
  }
  const unpinned = endpointsOf(server).find((endpoint) => !isPinnableUrl(endpoint));
  if (unpinned !== undefined) {
    return Effect.fail({ refused: 'unpinned_endpoint', endpoint: unpinned });
  }
  return Effect.flatMap(refusedHostOf(server, reaches), (rule) =>
    rule === undefined ? Effect.succeed(server) : Effect.fail({ refused: 'host', rule }),
  );
}

function metadataOf(
  { server, way, reaches }: ConsentAsked,
  fetch: FetchLike,
  boundToItsResource?: string,
): Effect.Effect<ServerMetadata, ConsentRefusal> {
  return Effect.gen(function* () {
    const protectedResource = yield* discoveredResourceOf(server, fetch);
    if (protectedResource === undefined && boundToItsResource !== undefined) {
      return yield* Effect.fail<ConsentRefusal>({ refused: 'authorization_server_unnamed', url: boundToItsResource });
    }
    const named = protectedResource?.authorization_servers ?? [way.issuer];
    if (!named.some((issuer) => isSameIssuer(issuer, way.issuer))) {
      return yield* Effect.fail<ConsentRefusal>({ refused: 'another_issuer', named: named.join(', '), by: 'server' });
    }
    const resolved = builtServerOf(way) ?? (yield* discoveredServerOf(way.issuer, fetch));
    return { server: yield* checkedServer(resolved, reaches), resource: protectedResource?.resource };
  });
}

export function serverMetadataOf(asked: ConsentAsked, fetch: FetchLike): Effect.Effect<ServerMetadata, ConsentRefusal> {
  return metadataOf(asked, fetch, handGivenUrlOf(asked.server));
}

export function revocationMetadataOf(
  asked: ConsentAsked,
  fetch: FetchLike,
): Effect.Effect<ServerMetadata, ConsentRefusal> {
  return metadataOf(asked, fetch);
}

export function scopeAskedOf({ scope }: ConsentWay, server: AuthorizationServer): string | undefined {
  return scope === undefined ? undefined : withOfflineAccess(scope, server.scopes_supported);
}
