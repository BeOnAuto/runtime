import { randomUUIDv7, textToKeep } from '@on.auto/operations';
import { alpha, resultOf } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openChoresWith, openLedgerWith } from '../testing/open-ledger.ts';
import { unnamedChunksLastMs } from './content-sweep.ts';
import { endingOf, sweepsWatched } from './watched-sweeps.ts';

const UploadRows = Schema.Array(Schema.Struct({ upload_id: Schema.String }));

const anHourOld = '00000000-0000-7000-8000-000000000001';

interface Orphans {
  readonly fresh: string;
  readonly named: readonly string[];
}

async function uploadsIn(entry: LedgerEntry, database: string, table: string): Promise<readonly string[]> {
  const rows = await entry.queried(database, `SELECT DISTINCT upload_id FROM ${table} ORDER BY upload_id`);
  return Schema.decodeUnknownSync(UploadRows)(rows).map(({ upload_id }) => upload_id);
}

async function orphanedLike(
  entry: LedgerEntry,
  database: string,
  named: readonly string[],
  upload: string,
): Promise<void> {
  await entry.queried(
    database,
    `INSERT INTO recorded_content_chunks (playbook_key, upload_id, chunk, data)
      SELECT playbook_key, '${upload}', chunk, data FROM recorded_content_chunks WHERE upload_id = '${named.join()}'`,
  );
}

async function keptAndOrphaned(entry: LedgerEntry, database: string): Promise<Orphans> {
  const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(database));
  onTestFinished(dispose);
  await resultOf(ledger.content.put(alpha, textToKeep('{"kept":true}', 'application/json')));
  const named = await uploadsIn(entry, database, 'recorded_content_chunks');
  const fresh = randomUUIDv7();
  await orphanedLike(entry, database, named, anHourOld);
  await orphanedLike(entry, database, named, fresh);
  return { fresh, named };
}

async function uploadsLeft(entry: LedgerEntry, database: string): Promise<readonly string[]> {
  return (await uploadsIn(entry, database, 'recorded_content_chunks')).toSorted();
}

function sweptByItsChore(entry: LedgerEntry): void {
  it('sweeps the chunks no head names when its chore is called, once their upload is an hour old, keeps every chunk a head names, and answers that it is due again an hour on', async () => {
    const database = await entry.aDatabase();
    const { fresh, named } = await keptAndOrphaned(entry, database);
    const watched = sweepsWatched(() => entry.openedOn(database));
    const { sweptAt, dispose } = await openChoresWith(watched.layer);
    onTestFinished(dispose);
    const now = Date.now();

    const dueAgainAt = await sweptAt(now);

    expect([await watched.finished, dueAgainAt]).toEqual(['swept', now + unnamedChunksLastMs]);
    expect(await uploadsLeft(entry, database)).toEqual([...named, fresh].toSorted());
  });
}

function sweepFinishedBeforeClosing(entry: LedgerEntry): void {
  it('finishes a sweep under way before it closes its store, when its runtime is disposed', async () => {
    const database = await entry.aDatabase();
    const { fresh, named } = await keptAndOrphaned(entry, database);
    const held = Promise.withResolvers<void>();
    const watched = sweepsWatched(() => entry.openedOn(database), held.promise);
    const { sweptAt, dispose } = await openChoresWith(watched.layer);
    const sweeping = endingOf(sweptAt(Date.now()));
    await watched.started;

    const disposing = dispose();
    held.resolve();
    await disposing;

    expect(await Promise.all([watched.finished, sweeping])).toEqual(['swept', 'ended']);
    expect(await uploadsLeft(entry, database)).toEqual([...named, fresh].toSorted());
  });
}

function sweptBefore(entry: LedgerEntry): void {
  it('sweeps every chunk no head names whose upload began before the time it is given', async () => {
    const database = await entry.aDatabase();
    const { named } = await keptAndOrphaned(entry, database);
    const store = entry.storeOn(database);
    onTestFinished(() => store.close());

    await store.sweepContent(Date.now() + unnamedChunksLastMs);

    expect(await uploadsLeft(entry, database)).toEqual(named.toSorted());
  });
}

export function unnamedChunksSwept(entry: LedgerEntry): void {
  describe('the chunks no head names', () => {
    sweptByItsChore(entry);
    sweepFinishedBeforeClosing(entry);
    sweptBefore(entry);
  });
}
