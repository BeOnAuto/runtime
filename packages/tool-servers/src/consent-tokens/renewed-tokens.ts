import { HostRefused } from '@on.auto/outbound';
import { Data, Effect } from 'effect';

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
  readonly endsAt: number;
}

interface Renewing extends Sourced {
  readonly renewal: Renewal;
  readonly refused: boolean;
  readonly deadline: number;
}

interface Claimed {
  readonly held: Held;
  readonly refreshToken: string;
  readonly refreshing: Refreshing;
  readonly until: number;
}

interface FailedClaim {
  readonly failure: unknown;
  readonly until: number;
}

interface Holding {
  held: Held;
  renewing: Promise<string> | undefined;
  failed: FailedClaim | undefined;
}

class FailedUnderItsClaim extends Data.TaggedError('failed_under_its_claim')<FailedClaim> {}

function heldFrom(tokens: KeptTokens, version: number, heldAt: number, { spreadMs }: Renewal): Held {
  const endsAt = tokens.expires_at === undefined ? Number.POSITIVE_INFINITY : Date.parse(tokens.expires_at);
  const renewAt =
    tokens.refresh_token === undefined ? Number.POSITIVE_INFINITY : renewalTimeOf(heldAt, endsAt, spreadMs);
  return { tokens, version, renewAt, endsAt };
}

function heldOf(tokens: KeptTokens, version: number, { serving, renewal }: Renewing): Held {
  heldAmongSecrets(tokens, serving);
  return heldFrom(tokens, version, serving.now(), renewal);
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

function failedUnder({ until }: Claimed, failure: unknown): Effect.Effect<never, FailedUnderItsClaim> {
  return Effect.fail(new FailedUnderItsClaim({ failure, until }));
}

function movedFrom(row: HeldTokens, renewing: Renewing): Effect.Effect<Held, unknown> {
  const taken = takenFrom(row, renewing);
  return isServable(taken, renewing) ? Effect.succeed(taken) : renewedFrom(taken, renewing);
}

function keptIn(claimed: Claimed, renewed: KeptTokens, renewing: Renewing): Effect.Effect<Held, unknown> {
  const { held, refreshing } = claimed;
  return renewing.served.tokens.replace(held.version, keptValueOf(renewed)).pipe(
    Effect.catch(({ detail }) => Effect.andThen(refreshing.revoked(renewed), failedUnder(claimed, new Error(detail)))),
    Effect.flatMap((replaced) =>
      replaced.replaced
        ? Effect.succeed(heldOf(renewed, replaced.version, renewing))
        : readOf(renewing).pipe(
            Effect.tapError(() => refreshing.revoked(renewed)),
            Effect.flatMap((row) => movedFrom(row, renewing)),
          ),
    ),
  );
}

function exchangedFor(claimed: Claimed, renewing: Renewing): Effect.Effect<Held, unknown> {
  const { held, refreshToken, refreshing } = claimed;
  return refreshing.refreshed(refreshToken, held.tokens, renewing.serving.now()).pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        isInvalidGrant(failure) ? afterRefusedGrant(held, renewing) : failedUnder(claimed, failure),
      onSuccess: (renewed) => keptIn(claimed, renewed, renewing),
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
      ? yield* exchangedFor({ held, refreshToken, refreshing, until: Date.parse(claim.until) }, renewing)
      : yield* renewedFrom(held, renewing);
  });
}

function fromRow(held: Held, row: HeldTokens, renewing: Renewing): Effect.Effect<Held, unknown> {
  if (row.version !== held.version) {
    return movedFrom(row, renewing);
  }
  return row.claimedUntil === undefined
    ? refreshedFrom(held, renewing)
    : Effect.andThen(waitedFor(row.claimedUntil, renewing), renewedFrom(held, renewing));
}

function renewedFrom(held: Held, renewing: Renewing): Effect.Effect<Held, unknown> {
  return Effect.flatMap(readOf(renewing), (row) => fromRow(held, row, renewing));
}

function underItsFailedClaim(failed: FailedClaim, held: Held, refused: boolean, { now }: TokenServing) {
  return !refused && now() < held.endsAt ? Effect.succeed(held.tokens.access_token) : Effect.fail(failed.failure);
}

export function renewedTokens(sourced: Sourced, renewal: Renewal): TokenSource {
  const { served, kept, heldAt, serving } = sourced;
  const holding: Holding = {
    held: heldFrom(kept, served.held.version, heldAt, renewal),
    renewing: undefined,
    failed: undefined,
  };
  const renewedAccess = (refused: boolean): Effect.Effect<string, unknown> =>
    Effect.suspend(() => {
      const { failed, held } = holding;
      if (failed !== undefined && serving.now() < failed.until) {
        return underItsFailedClaim(failed, held, refused, serving);
      }
      holding.failed = undefined;
      const renewing: Renewing = { ...sourced, renewal, refused, deadline: serving.now() + renewal.waitMs };
      return renewedFrom(held, renewing).pipe(
        Effect.map((renewed) => {
          holding.held = renewed;
          return renewed.tokens.access_token;
        }),
        Effect.catch((failure) => {
          if (failure instanceof FailedUnderItsClaim) {
            holding.failed = { failure: failure.failure, until: failure.until };
            return Effect.fail(failure.failure);
          }
          return Effect.fail(failure);
        }),
      );
    });
  const renewedOnce = (refused: boolean): Promise<string> => {
    holding.renewing ??= Effect.runPromise(renewedAccess(refused)).finally(() => {
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
