import {
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  resourceUrlFromServerUrl,
  type AuthorizationServerMetadata,
  type FetchLike,
} from '@modelcontextprotocol/client';
import type { Reaches } from '@on.auto/outbound';
import { Effect, Schema } from 'effect';

import { isSameIssuer } from './client-sources.ts';
import type { ConsentAsked, ConsentRefusal, ConsentServer, ConsentWay } from './consent-client.ts';
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
});

type ProtectedResource = typeof ProtectedResourceSchema.Type;

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

const noMetadata: ConsentRefusal = { refused: 'no_metadata' };

const noChallenge: ConsentRefusal = { refused: 'no_challenge' };

function isResourceOf(url: string, resource: string): boolean {
  return checkResourceAllowed({ requestedResource: resourceUrlFromServerUrl(url), configuredResource: resource });
}

function protectedResourceOf(
  server: ConsentServer,
  fetch: FetchLike,
): Effect.Effect<ProtectedResource | undefined, ConsentRefusal> {
  if (server.type === 'openapi') {
    return Effect.undefined;
  }
  const answered = { status: 0 };
  const observing: FetchLike = async (...[address, init]: readonly [unknown, unknown?]) => {
    answered.status = 0;
    const response = await fetch(String(address), Object.assign({}, init));
    answered.status = response.status;
    return response;
  };
  const discovered = Effect.tryPromise({
    try: () => discoverOAuthProtectedResourceMetadata(server.url, {}, observing),
    catch: (error) => error,
  }).pipe(Effect.map(protectedResourceOfAnswer));
  return Effect.matchEffect(discovered, {
    onSuccess: (metadata) =>
      isResourceOf(server.url, metadata.resource)
        ? Effect.succeed(metadata)
        : Effect.fail<ConsentRefusal>({ refused: 'another_resource', named: metadata.resource }),
    onFailure: (error) => (answered.status === notFound ? Effect.undefined : Effect.fail(refusalOf(error))),
  });
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

function discoveredServerOf(issuer: string, fetch: FetchLike): Effect.Effect<AuthorizationServer, ConsentRefusal> {
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

function checkedServer(
  server: AuthorizationServer,
  reaches: Reaches,
): Effect.Effect<AuthorizationServer, ConsentRefusal> {
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
    const protectedResource = yield* protectedResourceOf(server, fetch);
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
