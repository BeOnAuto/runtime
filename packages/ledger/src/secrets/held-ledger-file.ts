import { randomUUID } from 'node:crypto';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { SecretRows } from '@on.auto/secrets';
import { Effect, type Cause, type Exit } from 'effect';
import { onTestFinished } from 'vitest';

import { modestConnections } from '../sqlite3.ts';
import { stamped } from '../testing/happenings.ts';
import { openConnectionWith } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { sqliteLedgerFileOn, type SQLiteLedgerFile } from './sqlite-ledger-file.ts';

interface APlace {
  readonly place: string;
  readonly fileName: () => string;
  readonly inMemory: boolean;
}

function aTemporaryFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

export const onAFile: APlace = { place: 'a file', fileName: aTemporaryFile, inMemory: false };

export const places: readonly APlace[] = [onAFile, { place: ':memory:', fileName: () => ':memory:', inMemory: true }];

type InsideTheTransaction = () => Promise<void>;

export const committed: InsideTheTransaction = () => Promise.resolve();

export const rolledBack: InsideTheTransaction = () =>
  Promise.reject(new Error('The transaction of the ledger is rolled back'));

interface ALedgerFile {
  readonly file: SQLiteLedgerFile;
  readonly named: string;
  readonly inside: { work: InsideTheTransaction };
}

export function aLedgerFile({ fileName, inMemory }: APlace): ALedgerFile {
  const named = fileName();
  const inside = { work: committed };
  return {
    file: sqliteLedgerFileOn(
      {
        optionsOf: () => ({
          driver: sqlite3EventStoreDriver,
          fileName: named,
          connectionOptions: modestConnections,
          hooks: { onBeforeCommit: () => inside.work() },
        }),
        inMemory,
      },
      named,
    ),
    named,
    inside,
  };
}

type Appended = (inside: InsideTheTransaction) => Promise<void>;

interface AnOpenLedger {
  readonly rows: SecretRows;
  readonly received: Effect.Success<SQLiteLedgerFile['receivedWebhooks']>;
  readonly appended: Appended;
  readonly named: string;
}

export async function anOpenLedger(place: APlace): Promise<AnOpenLedger> {
  const { file, named, inside } = aLedgerFile(place);
  const { connection, dispose } = await openConnectionWith(file.ledgerLayer());
  onTestFinished(dispose);
  return {
    rows: await Effect.runPromise(file.secretRows),
    received: await Effect.runPromise(file.receivedWebhooks),
    named,
    appended: (work) => {
      inside.work = work;
      return connection.streams.append(`org/acme/notes/${randomUUID()}`, [{ type: 'noted', data: {} }], {
        expectedVersion: 0,
        context: stamped,
      });
    },
  };
}

export function exitOf(settling: Promise<void>): Promise<Exit.Exit<void>> {
  return Effect.runPromiseExit(Effect.promise(() => settling));
}

export function causeOf<A>(failing: Effect.Effect<A>): Promise<Cause.Cause<never>> {
  return Effect.runPromise(Effect.flip(Effect.sandbox(failing)));
}

export async function heldUntilLetGo(
  appended: Appended,
  ending: InsideTheTransaction,
): Promise<() => Promise<Exit.Exit<void>>> {
  const begun = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
  const held = exitOf(
    appended(async () => {
      begun.resolve();
      await letGo.promise;
      await ending();
    }),
  );
  await begun.promise;
  return () => {
    letGo.resolve();
    return held;
  };
}
