import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect, Result } from 'effect';

import { isPinnableUrl } from '../settings/checked.ts';
import { metadataDocumentOf, wayClientSources, type WayClientSource } from './client-sources.ts';
import type { IssuerRefusal, NamedWay, Refused, WayAsked, WayRefusal } from './consent-client.ts';
import { isScope } from './scopes.ts';
import {
  challengeOf,
  checkedServer,
  discoveredServerOf,
  noMetadata,
  protectedResourceOf,
  type AuthorizationServer,
  type Challenge,
  type ProtectedResource,
} from './server-metadata.ts';

type OwnSource = Exclude<WayClientSource, 'registered'>;

interface ReadServer {
  readonly issuer: string;
  readonly server: AuthorizationServer;
}

const noAuthorizationServer: WayRefusal = { refused: 'no_authorization_server' };

const noClient: Refused<'no_client'> = { refused: 'no_client' };

const malformedScope: Refused<'malformed_scope'> = { refused: 'malformed_scope' };

const ownSources: readonly OwnSource[] = wayClientSources.filter(
  (source): source is OwnSource => source !== 'registered',
);

function orNoAuthorizationServer<A>(found: A | undefined): Effect.Effect<A, WayRefusal> {
  return found === undefined ? Effect.fail(noAuthorizationServer) : Effect.succeed(found);
}

function atTheIssuer(issuer: string, refusal: IssuerRefusal | Refused<'host'>): WayRefusal {
  return refusal.refused === 'host' ? refusal : { refused: 'at_the_issuer', issuer, refusal };
}

function readAt(
  issuer: string,
  fetch: FetchLike,
): Effect.Effect<AuthorizationServer, Refused<'another_issuer' | 'no_metadata' | 'host' | 'unanswered'>> {
  return isPinnableUrl(issuer) ? discoveredServerOf(issuer, fetch) : Effect.fail(noMetadata);
}

function firstReadOf(issuers: readonly string[], fetch: FetchLike): Effect.Effect<ReadServer, WayRefusal> {
  return Effect.gen(function* () {
    const refusals: WayRefusal[] = [];
    for (const issuer of issuers) {
      const read = yield* Effect.result(readAt(issuer, fetch));
      if (Result.isSuccess(read)) {
        return { issuer, server: read.success };
      }
      refusals.push(atTheIssuer(issuer, read.failure));
    }
    return yield* Effect.fail(refusals[0] ?? noAuthorizationServer);
  });
}

function takes(server: AuthorizationServer, source: OwnSource, publicUrl: string | undefined): boolean {
  return source === 'dynamic'
    ? server.registration_endpoint !== undefined
    : server.client_id_metadata_document_supported === true && metadataDocumentOf(publicUrl) !== undefined;
}

function clientsAt(
  { issuer, server }: ReadServer,
  publicUrl: string | undefined,
): Effect.Effect<readonly WayClientSource[], WayRefusal> {
  const clients = ownSources.filter((source) => takes(server, source, publicUrl));
  return clients.length === 0 ? Effect.fail(atTheIssuer(issuer, noClient)) : Effect.succeed(clients);
}

function listedScopeOf({ scopes_supported: listed = [] }: ProtectedResource): string | undefined {
  return listed.length === 0 ? undefined : listed.join(' ');
}

function scopeNamedBy(
  challenge: Challenge,
  resource: ProtectedResource,
): Effect.Effect<string | undefined, WayRefusal> {
  const scope = challenge.scope ?? listedScopeOf(resource);
  return scope === undefined || isScope(scope) ? Effect.succeed(scope) : Effect.fail(malformedScope);
}

export function namedWayOf(
  { url, reaches }: WayAsked,
  fetch: FetchLike,
  publicUrl: string | undefined,
): Effect.Effect<NamedWay, WayRefusal> {
  return Effect.gen(function* () {
    const challenge = yield* Effect.flatMap(challengeOf(url, fetch), orNoAuthorizationServer);
    const resource = yield* Effect.flatMap(protectedResourceOf(url, fetch, challenge), orNoAuthorizationServer);
    const read = yield* firstReadOf(resource.authorization_servers ?? [], fetch);
    yield* Effect.mapError(checkedServer(read.server, reaches), (refusal) => atTheIssuer(read.issuer, refusal));
    const clients = yield* clientsAt(read, publicUrl);
    const scope = yield* scopeNamedBy(challenge, resource);
    return { issuer: read.issuer, clients, scope };
  });
}
