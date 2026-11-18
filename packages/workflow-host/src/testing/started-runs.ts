import { messageIdOf } from '@on.auto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { runPlacedIn } from '../runs/ledger-run-store.ts';
import { runKeyOf, runLogStreamOf } from '../runs/run-address.ts';
import { faultyDatabase, type FaultyDatabase } from './faulty-database.ts';
import { runAt } from './host-documents.ts';
import { aSQLiteFile, openedOn } from './host-files.ts';

export function runKeyAt(runId: string): string {
  return runKeyOf(runAt(runId));
}

export function logRecordOf(runId: string, version: number): string {
  return messageIdOf(runLogAt(runId), version);
}

export async function startedIn<Database extends HostDatabase>(database: Database, runId: string): Promise<Database> {
  await Effect.runPromise(runPlacedIn(database, runAt(runId)));
  return database;
}

export async function faultyWithARun(runId: string): Promise<FaultyDatabase> {
  return startedIn(faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() })), runId);
}

export function runLogAt(runId: string): string {
  return runLogStreamOf(runKeyAt(runId));
}

export async function openedWithRuns(runIds: readonly string[]): Promise<HostDatabase> {
  const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
  await Effect.runPromise(Effect.forEach(runIds, (runId) => runPlacedIn(database, runAt(runId)), { discard: true }));
  return database;
}

export function openedWithARun(runId: string): Promise<HostDatabase> {
  return openedWithRuns([runId]);
}
