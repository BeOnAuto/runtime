import { Effect } from 'effect';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface FaultyDatabase extends HostDatabase {
  readonly failing: (fails: boolean) => void;
  readonly failingWrites: (fails: boolean) => void;
  readonly writesRefused: () => number;
}

export function faultyDatabase(database: HostDatabase): FaultyDatabase {
  const faults = { failing: false, failingWrites: false, writesRefused: 0 };
  const failed = Effect.fail(new DatabaseFailed({ detail: 'The database was told to fail' }));
  const refused = Effect.suspend(() => {
    faults.writesRefused += 1;
    return failed;
  });
  return {
    ...database,
    read: (statement) => Effect.suspend(() => (faults.failing ? failed : database.read(statement))),
    write: (statement) =>
      Effect.suspend(() => (faults.failing || faults.failingWrites ? refused : database.write(statement))),
    failing: (fails) => {
      faults.failing = fails;
    },
    failingWrites: (fails) => {
      faults.failingWrites = fails;
    },
    writesRefused: () => faults.writesRefused,
  };
}
