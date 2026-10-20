import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/client';
import { Effect } from 'effect';

import { keptHandedOf, type HandedTokens, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import { renewalWords } from '../consent-tokens/renewal-words.ts';
import type { Refreshing } from '../consent-tokens/renewed-tokens.ts';
import type { Requests } from '../consent/acting-clients.ts';
import type { ConsentRefusal, ConsentServed, RevokeAsked } from '../consent/consent-client.ts';
import { scopeRenewedOf } from '../consent/scopes.ts';
import { serverMetadataOf } from '../consent/server-metadata.ts';
import { autoOf, type AutoOn, type ThroughAuto } from './auto-clients.ts';

interface Renewed {
  readonly handed: HandedTokens;
  readonly refreshToken: string;
  readonly previous: KeptTokens;
  readonly key: string;
}

interface RefreshAsked {
  readonly issuer: string;
  readonly resource: string | undefined;
  readonly name: string;
}

const clientGone: ConsentRefusal = { refused: 'client_gone' };

function renewedOf({ handed, refreshToken, previous, key }: Renewed): KeptTokens {
  const kept = { ...handed, refresh_token: handed.refresh_token ?? refreshToken };
  return keptHandedOf(kept, scopeRenewedOf(handed, previous), key);
}

function refusedGrant(name: string): Error {
  return new OAuthError(OAuthErrorCode.InvalidGrant, `Auto's consent service refused to renew the tokens of ${name}`);
}

function refreshingOf(auto: AutoOn, { issuer, resource, name }: RefreshAsked): Refreshing {
  return {
    refreshed: (refreshToken, previous) => {
      const key = previous.connection_key;
      if (key === undefined) {
        return Effect.fail(refusedGrant(name));
      }
      return auto.service.refresh({ issuer, refreshToken, connectionKey: key, resource }).pipe(
        Effect.map((handed) => renewedOf({ handed, refreshToken, previous, key })),
        Effect.mapError(({ refused }) =>
          refused === 'invalid_grant' ? refusedGrant(name) : new Error(renewalWords.unanswered(name)),
        ),
      );
    },
    revoked: (tokens) => Effect.ignore(auto.service.revoke({ issuer, tokens })),
  };
}

function refreshingThroughAuto(
  served: ConsentServed,
  name: string,
  { fetchFor, through }: { readonly fetchFor: Requests['fetchFor']; readonly through: ThroughAuto },
): Effect.Effect<Refreshing, ConsentRefusal> {
  return Effect.gen(function* () {
    const { resource } = yield* serverMetadataOf(served, fetchFor(served.reaches));
    const auto = autoOf(served.client, through);
    return auto === undefined
      ? yield* Effect.fail(clientGone)
      : refreshingOf(auto, { issuer: served.way.issuer, resource, name });
  });
}

function revokedThroughAuto(asked: RevokeAsked, through: ThroughAuto) {
  const auto = autoOf(asked.client, through);
  return auto === undefined
    ? Effect.fail(clientGone)
    : auto.service.revoke({ issuer: asked.way.issuer, tokens: asked.tokens });
}

export function autoRenewalsOf(fetchFor: Requests['fetchFor'], through: ThroughAuto) {
  return {
    refreshing: (served: ConsentServed, name: string) => refreshingThroughAuto(served, name, { fetchFor, through }),
    revoke: (asked: RevokeAsked) => revokedThroughAuto(asked, through),
  };
}
