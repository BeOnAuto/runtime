import { statement } from '@on.auto/ledger';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { failedRoundsOn } from './failed-rounds.ts';
import type { FailedRounds } from './host-wake-up.ts';

function writesFailing(database: HostDatabase): HostDatabase {
  return { ...database, write: () => Effect.fail(new DatabaseFailed({ detail: 'The test failed this write' })) };
}

function waitsOf(rounds: FailedRounds, failures: number): Promise<readonly number[]> {
  return Effect.runPromise(Effect.forEach(Array.from({ length: failures }), () => rounds.failed()));
}

describe('the rounds of a wake-up that failed in a row', () => {
  it('put the next round off a minute after the first, twice as long after each in a row, at most an hour', async () => {
    const rounds = failedRoundsOn(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), 'follower');

    expect(await waitsOf(rounds, 9)).toEqual([
      60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000,
    ]);
  });

  it('are counted in the database, so a wake-up composed again over it goes on counting, and a round that succeeds starts the count again', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const first = failedRoundsOn(database, 'follower');
    const second = failedRoundsOn(database, 'follower');
    const third = failedRoundsOn(database, 'follower');

    const waits = [...(await waitsOf(first, 2)), ...(await waitsOf(second, 1))];
    await Effect.runPromise(second.succeeded());
    await Effect.runPromise(second.succeeded());
    waits.push(...(await waitsOf(second, 1)));
    await Effect.runPromise(third.succeeded());
    const kept = await Effect.runPromise(database.read(statement`SELECT name, rounds FROM workflow_failed_rounds`));

    expect(waits).toEqual([60_000, 120_000, 240_000, 60_000]);
    expect(kept).toEqual([]);
  });

  it('are counted in memory while the database cannot be written, and a round that succeeds then fails as the write does', async () => {
    const rounds = failedRoundsOn(writesFailing(await openedOn({ store: 'sqlite', file: aSQLiteFile() })), 'follower');

    const waits = await waitsOf(rounds, 2);
    const succeeded = await Effect.runPromiseExit(rounds.succeeded());

    expect(waits).toEqual([60_000, 120_000]);
    expect(Exit.isFailure(succeeded)).toBe(true);
  });
});
