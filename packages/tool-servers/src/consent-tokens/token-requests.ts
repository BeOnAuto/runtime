import { refreshAuthorization, type FetchLike } from '@modelcontextprotocol/client';
import { Effect } from 'effect';

import { libraryClientOf, type ActingClient, type Requests } from '../consent/acting-clients.ts';
import type { ConsentRefusal, ConsentServed, RevocationFailure, RevokeAsked } from '../consent/consent-client.ts';
import { revocationOf } from '../consent/revocation.ts';
import { scopeRenewedOf } from '../consent/scopes.ts';
import {
  libraryMetadataOf,
  revocationMetadataOf,
  serverMetadataOf,
  type ServerMetadata,
} from '../consent/server-metadata.ts';
import {
  answeredTokensOf,
  keptOf,
  originsAskedAgainOf,
  resourcesAskedOf,
  sentWithResourcesBeside,
  tokenAnswersReadAsBearer,
  type AnsweredTokens,
  type AskedResources,
  type KeptTokens,
} from './kept-tokens.ts';
import { renewedTokens, type Refreshing, type RenewedTokens, type Sourced } from './renewed-tokens.ts';

export interface TokenRequests {
  readonly tokenSource: (sourced: Sourced) => RenewedTokens;
  readonly revoke: (asked: RevokeAsked) => Effect.Effect<void, RevocationFailure>;
}

export interface TokenRequesting {
  readonly requestMs: number;
  readonly renewalSpreadMs: number;
}

export interface ServiceRenewals {
  readonly refreshing: (served: ConsentServed, name: string) => Effect.Effect<Refreshing, ConsentRefusal>;
  readonly revoke: (asked: RevokeAsked) => Effect.Effect<void, RevocationFailure>;
}

interface Refreshed extends ServerMetadata {
  readonly issuer: string;
  readonly client: ActingClient;
  readonly fetch: FetchLike;
}

const leaseBeyondTheRequestMs = 15_000;

function leaseOf(requestMs: number): number {
  return requestMs + leaseBeyondTheRequestMs;
}

function revokedTokensOf({ access_token: accessToken, refresh_token: refreshToken }: KeptTokens) {
  return { access_token: accessToken, refresh_token: refreshToken };
}

function refreshedWith(
  { issuer, server, resource, client, fetch }: Refreshed,
  refreshToken: string,
  resources: AskedResources,
): Effect.Effect<AnsweredTokens, unknown> {
  return Effect.tryPromise({
    try: async () =>
      answeredTokensOf(
        await refreshAuthorization(issuer, {
          metadata: libraryMetadataOf(server),
          clientInformation: libraryClientOf(client.identity),
          refreshToken,
          fetchFn: tokenAnswersReadAsBearer(sentWithResourcesBeside(fetch, resources)),
          ...(resource === undefined ? {} : { resource }),
          ...(client.authentication === undefined ? {} : { addClientAuthentication: client.authentication }),
        }),
      ),
    catch: (error) => error,
  });
}

function refreshingOf(
  served: ConsentServed,
  { clients, fetchFor }: Requests,
): Effect.Effect<Refreshing, ConsentRefusal> {
  return Effect.gen(function* () {
    const fetch = fetchFor(served.reaches);
    const metadata = yield* serverMetadataOf(served, fetch);
    const client = yield* clients.recordedFor(served);
    const refreshed: Refreshed = { ...metadata, issuer: served.way.issuer, client, fetch };
    return {
      refreshed: (refreshToken, previous, nowMillis) => {
        const resources = resourcesAskedOf(metadata.resource, originsAskedAgainOf(previous, served.requestOrigins));
        return Effect.map(refreshedWith(refreshed, refreshToken, resources), (answered) =>
          keptOf(answered, scopeRenewedOf(answered, previous), nowMillis, resources.recorded),
        );
      },
      revoked: (tokens) =>
        Effect.ignore(revocationOf({ server: metadata.server, client, tokens: revokedTokensOf(tokens), fetch })),
    };
  });
}

function revocationAsked(asked: RevokeAsked, { clients, fetchFor }: Requests): Effect.Effect<void, RevocationFailure> {
  return Effect.gen(function* () {
    const fetch = fetchFor(asked.reaches);
    const { server } = yield* revocationMetadataOf(asked, fetch);
    const client = yield* clients.recordedFor(asked);
    yield* revocationOf({ server, client, tokens: revokedTokensOf(asked.tokens), fetch });
  });
}

function isThroughTheService({ client }: Pick<ConsentServed, 'client'>): boolean {
  return client.client_source === 'auto';
}

export function tokenRequestsOf(
  requests: Requests,
  { requestMs, renewalSpreadMs }: TokenRequesting,
  service: ServiceRenewals,
): TokenRequests {
  const renewal = {
    refreshing: (served: ConsentServed, name: string) =>
      isThroughTheService(served) ? service.refreshing(served, name) : refreshingOf(served, requests),
    leaseMs: leaseOf(requestMs),
    waitMs: requestMs,
    spreadMs: renewalSpreadMs,
  };
  return {
    tokenSource: (sourced) => renewedTokens(sourced, renewal),
    revoke: (asked) => (isThroughTheService(asked) ? service.revoke(asked) : revocationAsked(asked, requests)),
  };
}
