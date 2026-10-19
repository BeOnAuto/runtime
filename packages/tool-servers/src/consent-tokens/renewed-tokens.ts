import { HostRefused } from '@on.auto/outbound';
import { Effect } from 'effect';

import { renewalTimeOf, type TokenSource } from '../clients/token-source.ts';
import type {
  ConsentRefusal,
  ConsentServed,
  HeldTokens,
  TokenServing,
  TokensEnded,
} from '../consent/consent-client.ts';
import { isInvalidGrant } from '../consent/consent-failures.ts';
import type { ConnectionUnready } from '../org-servers/connection-source.ts';
import { heldAmongSecrets, keptTokensOf, keptValueOf, type KeptTokens } from './kept-tokens.ts';
import { renewalWords } from './renewal-words.ts';

export interface Refreshing {
  readonly refreshed: (
    refreshToken: string,
    previous: KeptTokens,
    nowMillis: number,
  ) => Effect.Effect<KeptTokens, unknown>;
  readonly revoked: (tokens: KeptTokens) => Effect.Effect<void>;
}

export interface Renewal {
  readonly refreshing: (served: ConsentServed) => Effect.Effect<Refreshing, ConsentRefusal>;
  readonly leaseMs: number;
  readonly waitMs: number;
  readonly spreadMs: number;
}

export interface Sourced {
  readonly served: ConsentServed;
  readonly kept: KeptTokens;
  readonly heldAt: number;
  readonly serving: TokenServing;
}

interface Held {
  readonly tokens: KeptTokens;
  readonly version: number;
  readonly renewAt: number;
}

interface Renewing extends Sourced {
  readonly renewal: Renewal;
  readonly refused: boolean;
  readonly deadline: number;
}

function renewalOf(tokens: KeptTokens, heldAt: number, { spreadMs }: Renewal): number {
  return tokens.expires_at === undefined || tokens.refresh_token === undefined
    ? Number.POSITIVE_INFINITY
    : renewalTimeOf(heldAt, Date.parse(tokens.expires_at), spreadMs);
}

function heldOf(tokens: KeptTokens, version: number, { serving, renewal }: Renewing): Held {
  heldAmongSecrets(tokens, serving);
  return { tokens, version, renewAt: renewalOf(tokens, serving.now(), renewal) };
}

function failedWith({ detail }: ConnectionUnready): Error {
  return new Error(detail);
}

function readOf({ served }: Renewing): Effect.Effect<HeldTokens, Error> {
  return Effect.mapError(served.tokens.read, failedWith);
}

function ended({ served }: Renewing, end: TokensEnded): Effect.Effect<never, Error> {
  return Effect.mapError(served.tokens.broken(end), failedWith);
}

function isServable(held: Held, { refused, serving }: Renewing): boolean {
  return refused || serving.now() < held.renewAt;
}

function waitedFor(until: string, { serving, deadline, renewal }: Renewing): Effect.Effect<void, Error> {
  const left = deadline - serving.now();
  if (left <= 0) {
    return Effect.fail(new Error(renewalWords.unfinished(serving.name, renewal.waitMs)));
  }
  const waitMs = Math.min(Math.max(0, Date.parse(until) - serving.now()), left);
  return Effect.callback<void>((resume) => {
    serving.timer.after(waitMs, () => {
      resume(Effect.void);
    });
  });
}

function refusedWith(refusal: ConsentRefusal, renewing: Renewing): Effect.Effect<never, Error> {
  if (refusal.refused === 'client_gone') {
    return ended(renewing, 'client_gone');
  }
  if (refusal.refused === 'host') {
    return Effect.fail(new HostRefused({ rule: refusal.rule }));
  }
  const { name } = renewing.serving;
  return Effect.fail(
    new Error(refusal.refused === 'unanswered' ? renewalWords.unanswered(name) : renewalWords.unrenewable(name)),
  );
}

function takenFrom(row: HeldTokens, renewing: Renewing): Held {
  return heldOf(keptTokensOf(row.value), row.version, renewing);
}

function afterRefusedGrant(held: Held, renewing: Renewing): Effect.Effect<Held, Error> {
  return Effect.flatMap(readOf(renewing), (row) =>
    row.version === held.version ? ended(renewing, 'consent_ended') : Effect.succeed(takenFrom(row, renewing)),
  );
}

function keptIn(held: Held, refreshing: Refreshing, renewed: KeptTokens, renewing: Renewing) {
  return Effect.gen(function* () {
    const replacing = renewing.served.tokens.replace(held.version, keptValueOf(renewed));
    const replaced = yield* replacing.pipe(
      Effect.catch(({ detail }) => Effect.andThen(refreshing.revoked(renewed), Effect.fail(new Error(detail)))),
    );
    if (!replaced.replaced) {
      yield* refreshing.revoked(renewed);
      return yield* renewedFrom(held, renewing);
    }
    return heldOf(renewed, replaced.version, renewing);
  });
}

function exchangedFor(held: Held, refreshToken: string, refreshing: Refreshing, renewing: Renewing) {
  return refreshing.refreshed(refreshToken, held.tokens, renewing.serving.now()).pipe(
    Effect.matchEffect({
      onFailure: (failure) => (isInvalidGrant(failure) ? afterRefusedGrant(held, renewing) : Effect.fail(failure)),
      onSuccess: (renewed) => keptIn(held, refreshing, renewed, renewing),
    }),
  );
}

function refreshedFrom(held: Held, renewing: Renewing): Effect.Effect<Held, unknown> {
  return Effect.gen(function* () {
    const refreshToken = held.tokens.refresh_token;
    if (refreshToken === undefined) {
      return yield* ended(renewing, 'consent_ended');
    }
    const refreshing = yield* renewing.renewal
      .refreshing(renewing.served)
      .pipe(Effect.catch((refusal) => refusedWith(refusal, renewing)));
    const claim = yield* renewing.served.tokens.claim(held.version, renewing.renewal.leaseMs);
    return claim.claimed
      ? yield* exchangedFor(held, refreshToken, refreshing, renewing)
      : yield* renewedFrom(held, renewing);
  });
}

function renewedFrom(held: Held, renewing: Renewing): Effect.Effect<Held, unknown> {
  return Effect.gen(function* () {
    const row = yield* readOf(renewing);
    if (row.version !== held.version) {
      const taken = takenFrom(row, renewing);
      return isServable(taken, renewing) ? taken : yield* renewedFrom(taken, renewing);
    }
    if (row.claimedUntil !== undefined) {
      yield* waitedFor(row.claimedUntil, renewing);
      return yield* renewedFrom(held, renewing);
    }
    return yield* refreshedFrom(held, renewing);
  });
}

export function renewedTokens(sourced: Sourced, renewal: Renewal): TokenSource {
  const { served, kept, heldAt, serving } = sourced;
  const holding: { held: Held; renewing: Promise<string> | undefined } = {
    held: { tokens: kept, version: served.held.version, renewAt: renewalOf(kept, heldAt, renewal) },
    renewing: undefined,
  };
  const renewedOnce = (refused: boolean): Promise<string> => {
    const renewing: Renewing = { ...sourced, renewal, refused, deadline: serving.now() + renewal.waitMs };
    holding.renewing ??= Effect.runPromise(renewedFrom(holding.held, renewing))
      .then((renewed) => {
        holding.held = renewed;
        return renewed.tokens.access_token;
      })
      .finally(() => {
        holding.renewing = undefined;
      });
    return holding.renewing;
  };
  return {
    token: () =>
      serving.now() < holding.held.renewAt ? Promise.resolve(holding.held.tokens.access_token) : renewedOnce(false),
    onUnauthorized: async () => {
      await renewedOnce(true);
    },
  };
}
