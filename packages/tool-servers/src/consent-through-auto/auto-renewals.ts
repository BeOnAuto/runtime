import { Effect } from 'effect';

import { keptHandedOf, type HandedTokens, type KeptTokens } from '../consent-tokens/kept-tokens.ts';
import { RefreshEnded } from '../consent-tokens/refresh-endings.ts';
import { renewalWords } from '../consent-tokens/renewal-words.ts';
import type { Refreshing } from '../consent-tokens/renewed-tokens.ts';
import type { Requests } from '../consent/acting-clients.ts';
import type {
  ConsentRefusal,
  ConsentServed,
  RevocationFailure,
  RevokeAsked,
  TokensEnded,
} from '../consent/consent-client.ts';
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

const unknownKey: RevocationFailure = { refused: 'unknown_key' };

const endings: Readonly<Record<'invalid_grant' | 'unknown_key', TokensEnded>> = {
  invalid_grant: 'consent_ended',
  unknown_key: 'key_unknown',
};

function renewedOf({ handed, refreshToken, previous, key }: Renewed): KeptTokens {
  const kept = { ...handed, refresh_token: handed.refresh_token ?? refreshToken };
  return keptHandedOf(kept, scopeRenewedOf(handed, previous), key);
}

type RefreshRefused = { readonly refused: 'unanswered' | keyof typeof endings };

function failureOfARefresh({ refused }: RefreshRefused, name: string): Error | RefreshEnded {
  return refused === 'unanswered'
    ? new Error(renewalWords.serviceUnanswered(name))
    : new RefreshEnded({ ended: endings[refused] });
}

function revokedThrough(auto: AutoOn, issuer: string, tokens: KeptTokens): Effect.Effect<void, RevocationFailure> {
  const key = tokens.connection_key;
  return key === undefined ? Effect.fail(unknownKey) : auto.service.revoke({ issuer, tokens, connectionKey: key });
}

function refreshingOf(auto: AutoOn, { issuer, resource, name }: RefreshAsked): Refreshing {
  return {
    refreshed: (refreshToken, previous) => {
      const key = previous.connection_key;
      if (key === undefined) {
        return Effect.fail(new RefreshEnded({ ended: 'key_unknown' }));
      }
      return auto.service.refresh({ issuer, refreshToken, connectionKey: key, resource }).pipe(
        Effect.map((handed) => renewedOf({ handed, refreshToken, previous, key })),
        Effect.mapError((refusal) => failureOfARefresh(refusal, name)),
      );
    },
    revoked: (tokens) => Effect.ignore(revokedThrough(auto, issuer, tokens)),
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

function revokedThroughAuto(asked: RevokeAsked, through: ThroughAuto): Effect.Effect<void, RevocationFailure> {
  const auto = autoOf(asked.client, through);
  return auto === undefined ? Effect.fail(clientGone) : revokedThrough(auto, asked.way.issuer, asked.tokens);
}

export function autoRenewalsOf(fetchFor: Requests['fetchFor'], through: ThroughAuto) {
  return {
    refreshing: (served: ConsentServed, name: string) => refreshingThroughAuto(served, name, { fetchFor, through }),
    revoke: (asked: RevokeAsked) => revokedThroughAuto(asked, through),
  };
}
