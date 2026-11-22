import { AsyncLocalStorage } from 'node:async_hooks';

import { statementOf, type ConnectionPorts, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

export const WholeNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

export function chunksOf<A>(values: readonly A[], most: number): readonly (readonly [A, ...A[]])[] {
  const [first, ...rest] = values;
  if (first === undefined) {
    return [];
  }
  const chunk: readonly [A, ...A[]] = [first, ...rest.slice(0, most - 1)];
  return [chunk, ...chunksOf(rest.slice(most - 1), most)];
}

export function oneOf(asked: string, values: readonly [string, ...string[]]): Statement {
  return statementOf([`${asked} IN (`, ...values.slice(1).map(() => ', '), ')'], values);
}

export type ChatDatabase = Pick<
  ConnectionPorts,
  'dialect' | 'read' | 'write' | 'transaction' | 'migrated' | 'sharedClock' | 'mostBoundValues'
>;

export type ChatClock = () => Promise<number>;

const systemClock: ChatClock = () => Promise.resolve(Date.now());

export function clockOf({ sharedClock }: Pick<ChatDatabase, 'sharedClock'>): ChatClock {
  return sharedClock ?? systemClock;
}

export function ambientTransactionSuppressed(database: ChatDatabase): ChatDatabase {
  const outsideAnyTransaction = AsyncLocalStorage.snapshot();
  return {
    dialect: database.dialect,
    read: (asked) => outsideAnyTransaction(() => database.read(asked)),
    write: (asked) => outsideAnyTransaction(() => database.write(asked)),
    transaction: (statements) => outsideAnyTransaction(() => database.transaction(statements)),
    migrated: (statements) => outsideAnyTransaction(() => database.migrated(statements)),
    sharedClock: database.sharedClock,
    mostBoundValues: database.mostBoundValues,
  };
}
