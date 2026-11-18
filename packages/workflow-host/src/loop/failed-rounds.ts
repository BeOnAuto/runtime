import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { HostClock } from './host-clock.ts';

export interface FailedRounds {
  readonly failed: () => Effect.Effect<number>;
  readonly succeeded: () => Effect.Effect<void>;
}

export const firstRoundRetryMs = 60_000;

const mostRoundRetryMs = 60 * 60_000;

function roundRetryAfter(rounds: number): number {
  return Math.min(mostRoundRetryMs, firstRoundRetryMs * 2 ** (rounds - 1));
}

const Counted = Schema.Struct({ rounds: WholeNumber });

export function failedRoundsOn(database: HostDatabase, name: string): FailedRounds {
  const counted: { rounds: number | undefined } = { rounds: undefined };
  const keptAs = (rounds: number) =>
    Effect.sync(() => {
      counted.rounds = rounds;
      return rounds;
    });
  return {
    failed: () =>
      oneRowOf(
        Counted,
        database.write(
          statement`INSERT INTO workflow_failed_rounds (name, rounds) VALUES (${name}, 1)
            ON CONFLICT (name) DO UPDATE SET rounds = workflow_failed_rounds.rounds + 1
            RETURNING rounds`,
        ),
      ).pipe(
        Effect.map(({ rounds }) => rounds),
        Effect.catchCause(() => Effect.sync(() => (counted.rounds ?? 0) + 1)),
        Effect.flatMap(keptAs),
        Effect.map(roundRetryAfter),
      ),
    succeeded: () =>
      Effect.suspend(() =>
        counted.rounds === 0
          ? Effect.void
          : Effect.asVoid(
              Effect.andThen(
                Effect.orDie(database.write(statement`DELETE FROM workflow_failed_rounds WHERE name = ${name}`)),
                keptAs(0),
              ),
            ),
      ),
  };
}

export function failedRoundsInMemory(): FailedRounds {
  const counted = { rounds: 0 };
  return {
    failed: () =>
      Effect.sync(() => {
        counted.rounds += 1;
        return roundRetryAfter(counted.rounds);
      }),
    succeeded: () =>
      Effect.sync(() => {
        counted.rounds = 0;
      }),
  };
}

export function earliestOf(one: number | null, other: number | null): number | null {
  return one === null ? other : Math.min(one, other ?? one);
}

export interface NextDueRead {
  readonly nextDueAt: number | null;
  readonly failed: boolean;
}

export function nextDueRead(nextDueAt: number | null): NextDueRead {
  return { nextDueAt, failed: false };
}

export function failedNextDueRead(knownAt: number | null): NextDueRead {
  return { nextDueAt: knownAt, failed: true };
}

export function earliestOfReads(reads: readonly NextDueRead[]): NextDueRead {
  return {
    nextDueAt: reads.reduce<number | null>((earliest, { nextDueAt }) => earliestOf(earliest, nextDueAt), null),
    failed: reads.some(({ failed }) => failed),
  };
}

interface ReadsInARow {
  readonly failedReads: FailedRounds;
  readonly clock: Pick<HostClock, 'now'>;
}

export function nextDueAfter(
  { nextDueAt, failed }: NextDueRead,
  { failedReads, clock }: ReadsInARow,
): Effect.Effect<number | null> {
  return failed
    ? Effect.map(failedReads.failed(), (retryAfterMs) => earliestOf(nextDueAt, clock.now() + retryAfterMs))
    : Effect.as(failedReads.succeeded(), nextDueAt);
}
