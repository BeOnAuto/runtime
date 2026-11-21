import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { signals, type Signals } from '../testing/signals.ts';

export interface DatabaseTracking {
  readonly over: (database: HostDatabase) => HostDatabase;
  readonly busy: () => number;
  readonly changed: Signals['changed'];
  readonly when: Signals['when'];
  readonly whenRead: Signals['whenRead'];
}

export function databaseTracking(): DatabaseTracking {
  const counts = { busy: 0 };
  const seen = signals();
  const busyWhile = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.suspend(() => {
      counts.busy += 1;
      return work;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          counts.busy -= 1;
          seen.changed();
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
        readRecordedOfKeys: async (keys, selection, page) => {
          counts.busy += 1;
          try {
            return await database.store.readRecordedOfKeys(keys, selection, page);
          } finally {
            counts.busy -= 1;
            seen.changed();
          }
        },
      },
    }),
    busy: () => counts.busy,
    ...seen,
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
  return tracking.when(
    (): Holding => ({ waiting: waiting(), busy: tracking.busy() }),
    (now) => now.waiting === held && now.busy === 0,
  );
}
