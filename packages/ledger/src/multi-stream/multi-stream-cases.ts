import type { KeptProjection } from '@on.auto/operations';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { DefinitionNames } from '../definition-names/definition-names.ts';
import type { AppendPlace, EncodedEvent, LedgerStore } from '../event-store.ts';
import type { LoggedEvent } from '../log/ledger-log.ts';
import { stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import type { AppendStreamRequest } from './multi-stream-appends.ts';

export interface StoreKept {
  readonly projections?: readonly KeptProjection[];
  readonly definitionNames?: DefinitionNames;
}

export interface MultiStreamEntry extends LedgerEntry {
  readonly storeKeeping: (database: string, kept: StoreKept) => LedgerStore;
}

export const alpha = 'playbook/acme/alpha/';

export const r0 = `${alpha}runs/r0`;

export const r1 = `${alpha}runs/r1`;

export const r2 = `${alpha}runs/r2`;

export const r3 = `${alpha}runs/r3`;

export const triageKey = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a/';

export const triage = `${triageKey}definitions`;

export const summary = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b/definitions';

export const review = 'definition/acme/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7c/definitions';

export function at(expectedVersion: number): AppendPlace {
  return { expectedVersion, context: stamped };
}

export function noted(n: number): EncodedEvent {
  return { type: 'noted', data: { n } };
}

export const began: EncodedEvent = { type: 'run_began', data: { at: stamped.at, fn: 'triage' } };

export function to(stream: string, expectedVersion: number, ...events: readonly EncodedEvent[]): AppendStreamRequest {
  return { stream, events, place: at(expectedVersion) };
}

export async function aStoreKeeping(
  entry: MultiStreamEntry,
  kept: StoreKept = {},
  database?: string,
): Promise<LedgerStore> {
  const store = entry.storeKeeping(database ?? (await entry.aDatabase()), kept);
  onTestFinished(() => store.close());
  await store.migrate();
  return store;
}

export function refusalOf(appended: Promise<void>): Promise<unknown> {
  return appended.catch((error: unknown) => error);
}

export type Logged = readonly [string, number, string];

export function placeOf({ stream, version, id }: LoggedEvent): Logged {
  return [stream, version, id];
}

export async function logged(store: LedgerStore): Promise<readonly Logged[]> {
  return (await store.log.after(undefined, 100)).events.map(placeOf);
}

export function versionsOf(store: LedgerStore, streams: readonly string[]): Promise<readonly number[]> {
  return Promise.all(streams.map(async (stream) => (await store.read(stream)).version));
}

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 10 } as const;

export async function rowsOf(
  store: LedgerStore,
  projection: string,
  columns: readonly string[],
): Promise<readonly unknown[]> {
  const rows = await Effect.runPromise(
    store.readProjectedRows(projection, { org: 'acme', playbook: 'alpha' }, everyRow),
  );
  return rows.map(({ key, row }) => [key, columns.map((column) => row[column])]);
}
