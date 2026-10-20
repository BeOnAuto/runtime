import { DateTime, Effect, Option } from 'effect';
import { describe } from 'vitest';

import { memoryRows, type MemoryRows } from './memory-rows.ts';
import { rowsBehaviour } from './rows-behaviour.ts';
import type { SecretsEntry } from './secrets-entry.ts';
import { storeBehaviour } from './store-behaviour.ts';

const databases = new Map<string, MemoryRows>();

function rowsNamed(database: string): MemoryRows {
  return Option.getOrThrow(Option.fromNullishOr(databases.get(database)));
}

const inMemory: SecretsEntry = {
  aDatabase: () => {
    const database = `memory-${databases.size + 1}`;
    databases.set(database, memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) }));
    return Promise.resolve(database);
  },
  rowsOn: (database) => Effect.sync(() => rowsNamed(database)),
  rowsIn: (database) => Promise.resolve(rowsNamed(database).kept()),
};

describe('the rows kept in memory', () => {
  rowsBehaviour(inMemory);
  storeBehaviour(inMemory);
});
