import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import type { FailedRounds } from './host-wake-up.ts';

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
