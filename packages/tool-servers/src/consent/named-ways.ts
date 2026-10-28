import type { FetchLike } from '@modelcontextprotocol/client';
import { Effect, Result } from 'effect';

import { noClient, takesOwnSource, type OwnSource } from './acting-clients.ts';
import type { WayClientSource } from './client-sources.ts';
import type { IssuerRefusal, NamedWay, Refused, WayAsked, WayRefusal } from './consent-client.ts';
import { isScope } from './scopes.ts';
import {
  answeredNotFound,
  checkedServer,
  discoveredServerOf,
  pingedAt,
  protectedResourceOf,
  type AuthorizationServer,
  type Challenge,
  type ProtectedResource,
} from './server-metadata.ts';

interface ReadServer {
  readonly issuer: string;
  readonly server: AuthorizationServer;
}

const mostIssuersRead = 5;

const noAuthorizationServer: WayRefusal = { refused: 'no_authorization_server' };

const malformedScope: Refused<'malformed_scope'> = { refused: 'malformed_scope' };

const sourcesOfAServerGivenByHand: readonly OwnSource[] = ['dynamic', 'metadata_document'];

const clientErrors = { first: 400, past: 500 };

function orNoAuthorizationServer<A>(found: A | undefined): Effect.Effect<A, WayRefusal> {
  return found === undefined ? Effect.fail(noAuthorizationServer) : Effect.succeed(found);
}

function answeredAClientError(status: number): boolean {
  return status >= clientErrors.first && status < clientErrors.past;
}

function unpublishedWhere({ resourceMetadata }: Challenge): typeof answeredNotFound {
  return resourceMetadata === undefined ? answeredAClientError : answeredNotFound;
}

function atTheIssuer(issuer: string, refusal: IssuerRefusal | Refused<'host'>): WayRefusal {
  return refusal.refused === 'host' ? refusal : { refused: 'at_the_issuer', issuer, refusal };
}

function firstReadOf(issuers: readonly string[], fetch: FetchLike): Effect.Effect<ReadServer, WayRefusal> {
  return Effect.gen(function* () {
    let first: WayRefusal | undefined;
    for (const issuer of issuers.slice(0, mostIssuersRead)) {
      const read = yield* Effect.result(discoveredServerOf(issuer, fetch));
      if (Result.isSuccess(read)) {
        return { issuer, server: read.success };
      }
      first ??= atTheIssuer(issuer, read.failure);
    }
    return yield* Effect.fail(first ?? noAuthorizationServer);
  });
}

function clientsAt(
  { issuer, server }: ReadServer,
  publicUrl: string | undefined,
): Effect.Effect<readonly WayClientSource[], WayRefusal> {
  const taken = sourcesOfAServerGivenByHand.find((source) => takesOwnSource(server, source, publicUrl));
  return taken === undefined ? Effect.fail(atTheIssuer(issuer, noClient)) : Effect.succeed([taken]);
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
    const { takesNoToken, challenge } = yield* pingedAt(url, fetch);
    if (takesNoToken) {
      return yield* Effect.fail(noAuthorizationServer);
    }
    const resource = yield* Effect.flatMap(
      protectedResourceOf(url, fetch, challenge, unpublishedWhere(challenge)),
      orNoAuthorizationServer,
    );
    const read = yield* firstReadOf(resource.authorization_servers ?? [], fetch);
    yield* Effect.mapError(checkedServer(read.server, reaches), (refusal) => atTheIssuer(read.issuer, refusal));
    const clients = yield* clientsAt(read, publicUrl);
    const scope = yield* scopeNamedBy(challenge, resource);
    return { issuer: read.issuer, clients, scope };
  });
}
