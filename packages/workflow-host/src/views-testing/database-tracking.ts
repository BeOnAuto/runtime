import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { until } from '../testing/until.ts';

export interface DatabaseTracking {
  readonly over: (database: HostDatabase) => HostDatabase;
  readonly busy: () => number;
}

export function databaseTracking(): DatabaseTracking {
  const counts = { busy: 0 };
  const busyWhile = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      counts.busy += 1;
      return work;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          counts.busy -= 1;
        }),
      ),
    );
  return {
    over: (database) => ({
      ...database,
      read: (statement) => busyWhile(database.read(statement)),
      write: (statement) => busyWhile(database.write(statement)),
      store: {
        ...database.store,
        readRecorded: async (playbookKey, selection, page) => {
          counts.busy += 1;
          try {
            return await database.store.readRecorded(playbookKey, selection, page);
          } finally {
            counts.busy -= 1;
          }
        },
      },
    }),
    busy: () => counts.busy,
  };
}

interface Holding {
  readonly waiting: number;
  readonly busy: number;
}

export function untilOnlyTheHeldWait(
  waiting: () => number,
  tracking: DatabaseTracking,
  held: number,
): Promise<unknown> {
  return until(
    (): Holding => ({ waiting: waiting(), busy: tracking.busy() }),
    (now) => now.waiting === held && now.busy === 0,
  );
}
