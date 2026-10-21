import { Effect } from 'effect';

import type { Keeper, Keepers, ReadingFailure } from '../keepers/keeper.ts';
import type { HeldRow, SecretRows } from '../rows/secret-rows.ts';
import { answeredWithinItsBound } from './answer-bound.ts';
import { releasedOrLeft } from './named-keepers.ts';
import { SecretRefused, type SecretRefusedBecause } from './secret-refused.ts';

export type MoveFailure = ReadingFailure | SecretRefused;

const rowsInABatch = 100;

interface Move {
  readonly current: Keeper;
  readonly previous: Keeper;
  readonly isNewKid: (kid: string) => boolean;
}

interface Worded {
  readonly detail: string;
}

interface Refused extends Worded {
  readonly because: SecretRefusedBecause;
}

function leftUnderAStrayKid(move: Move, kid: string, { detail }: Worded): Effect.Effect<boolean> {
  return Effect.suspend(() =>
    move.isNewKid(kid)
      ? Effect.as(
          Effect.logWarning(
            `Secrets are left with the previous keeper, unmoved, until their key is given: ${detail}`,
          ).pipe(Effect.annotateLogs({ secrets_kid: kid })),
          false,
        )
      : Effect.succeed(false),
  );
}

function leftRefused(read: HeldRow, refusal: Refused): Effect.Effect<boolean, SecretRefused> {
  return refusal.because === 'over_the_keepers_quota'
    ? Effect.fail(new SecretRefused(refusal))
    : Effect.as(
        Effect.logWarning(
          `A secret is left with the previous keeper, unmoved, since the current one refused its value: ${refusal.detail}`,
        ).pipe(Effect.annotateLogs({ secret_id: read.id })),
        false,
      );
}

function heldAgain(rows: SecretRows, move: Move, read: HeldRow, holding: HeldRow['holding']) {
  return Effect.flatMap(rows.reheld(read, holding), (reheld) =>
    reheld ? Effect.as(releasedOrLeft(move.previous, read.holding), true) : Effect.succeed(false),
  );
}

function movedOne(rows: SecretRows, move: Move, read: HeldRow): Effect.Effect<boolean, MoveFailure> {
  return answeredWithinItsBound(move.previous.reveal(read.holding)).pipe(
    Effect.flatMap((value) =>
      value === undefined
        ? Effect.succeed(false)
        : answeredWithinItsBound(move.current.hold(read.id, value)).pipe(
            Effect.flatMap((holding) => heldAgain(rows, move, read, holding)),
            Effect.catchTag('secret_refused', (refusal: Refused) => leftRefused(read, refusal)),
          ),
    ),
    Effect.catchTag('secret_key_unknown', (unknown: Worded & { readonly kid: string }) =>
      leftUnderAStrayKid(move, unknown.kid, unknown),
    ),
  );
}

function movedInBatches(
  rows: SecretRows,
  move: Move,
  after: string | undefined,
  before: number,
): Effect.Effect<number, MoveFailure> {
  return Effect.gen(function* () {
    const held = yield* rows.heldBy({ keptBy: move.previous.name }, rowsInABatch, after);
    const moved = yield* Effect.forEach(held, (read) => movedOne(rows, move, read));
    const count = before + moved.filter(Boolean).length;
    const last = held.at(-1);
    return held.length < rowsInABatch || last === undefined ? count : yield* movedInBatches(rows, move, last.id, count);
  });
}

export function movedOn(rows: SecretRows, { current, previous }: Keepers): Effect.Effect<number, MoveFailure> {
  return previous === undefined || previous.name === current.name
    ? Effect.succeed(0)
    : Effect.suspend(() => {
        const strayKids = new Set<string>();
        const isNewKid = (kid: string) => {
          const isNew = !strayKids.has(kid);
          strayKids.add(kid);
          return isNew;
        };
        return movedInBatches(rows, { current, previous, isNewKid }, undefined, 0);
      });
}
