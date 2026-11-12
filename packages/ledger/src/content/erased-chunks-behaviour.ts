import { textToKeep, type ContentOwner } from '@on.auto/content';
import {
  alpha,
  at,
  defectOf,
  generated,
  json,
  memoryContentStore,
  octets,
  pausableStore,
  present,
  readBack,
  resultOf,
  settledWithin,
} from '@on.auto/content/testing';
import { streamPrefixOfPlaybook, uuidV7TimeOf } from '@on.auto/operations';
import { noteHolders } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { anErasingLedger, anErasingLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';
import { ownExpiredErasedOn, unnamedChunksLastMs, unnamedChunksSwept } from './content-sweep.ts';
import { keptShelf } from './content-tables.ts';

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const aDay = 86_400_000;

const note = '{"note":"kept in the ledger until it expires"}';

export async function chunksHeldIn(
  entry: LedgerEntry,
  database: string,
  playbook: ContentOwner,
  sha256: string,
): Promise<boolean> {
  const rows = await entry.queried(
    database,
    `SELECT CAST(count(*) AS INTEGER) AS count FROM recorded_content_chunks c
      JOIN recorded_content_heads h ON h.playbook_key = c.playbook_key AND h.upload_id = c.upload_id
      WHERE h.playbook_key = '${streamPrefixOfPlaybook(playbook)}' AND h.sha256 = '${sha256}'`,
  );
  return Schema.decodeUnknownSync(CountRows)(rows).some(({ count }) => count > 0);
}

const unnamedChunks = `SELECT CAST(count(*) AS INTEGER) AS count FROM recorded_content_chunks c WHERE NOT EXISTS (
  SELECT 1 FROM recorded_content_heads h WHERE h.playbook_key = c.playbook_key AND h.upload_id = c.upload_id)`;

async function unnamedIn(entry: LedgerEntry, database: string): Promise<number> {
  const rows = Schema.decodeUnknownSync(CountRows)(await entry.queried(database, unnamedChunks));
  return rows.reduce((total, { count }) => total + count, 0);
}

function stoppedBeforeItsDelete(execute: StatementExecutor): StatementExecutor {
  return {
    query: (sql) => execute.query(sql),
    command: () => Promise.reject(new Error('The erasure stopped before it deleted the chunks')),
  };
}

function sweptOnceErased(entry: LedgerEntry): void {
  it('leaves the chunks of the upload it erased named by no head where it stops between the record of the erasure and their delete, so the sweep takes them, and keeps those of a head that stands', async () => {
    const database = await entry.aDatabase();
    const { ledger } = await anErasingLedger(entry, noteHolders, database);
    const [erased, standing] = [await generated(2_500_000, 51), await generated(1000, 53)];
    await resultOf(ledger.content.put(alpha, { ...erased.content(), expiresAt: keptAt }));
    await resultOf(ledger.content.put(alpha, standing.content()));
    const store = entry.storeOn(database);
    onTestFinished(() => store.close());

    const stopped = await entry.executedOn(database, (execute) =>
      ownExpiredErasedOn(stoppedBeforeItsDelete(execute))(keptAt, 10).catch((stop: unknown) => stop),
    );
    const leftUnnamed = await unnamedIn(entry, database);
    await store.sweepContent(Date.now() + unnamedChunksLastMs);

    expect([stopped, leftUnnamed, await unnamedIn(entry, database)]).toEqual([
      new Error('The erasure stopped before it deleted the chunks'),
      3,
      0,
    ]);
    expect((await resultOf(ledger.content.getHead(alpha, erased.sha256)))?.erasedAt).toBe(keptAt);
    expect(await chunksHeldIn(entry, database, alpha, standing.sha256)).toBe(true);
  });
}

function keptAgainWhileErasing(entry: LedgerEntry): void {
  it('deletes, of its own content, the chunks of the upload it erased alone, so a put that keeps the content again while the erasure is on its way keeps its own chunks whole', async () => {
    const database = await entry.aDatabase();
    const { ledger } = await anErasingLedger(entry, noteHolders, database);
    const content = await generated(2_500_000, 57);
    await at(keptAt, ledger.content.put(alpha, { ...content.content(), expiresAt: keptAt + 1 }));
    const [reached, deleting] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];

    const erasure = entry.executedOn(database, (execute) =>
      ownExpiredErasedOn({
        query: (sql) => execute.query(sql),
        command: async (sql) => {
          reached.resolve();
          await deleting.promise;
          return execute.command(sql);
        },
      })(keptAt + aDay, 10),
    );
    await reached.promise;
    const kept = await resultOf(ledger.content.put(alpha, content.content()));
    deleting.resolve();

    expect([await erasure, kept]).toEqual([
      { erased: 1, more: false },
      { sha256: content.sha256, bytes: 2_500_000, mediaType: octets },
    ]);
    expect(await readBack(await present(ledger.content.get(alpha, content.sha256)))).toMatchObject({
      sha256: content.sha256,
      bytes: 2_500_000,
    });
  });
}

function sweepsThroughTheUploadIndex(entry: LedgerEntry): void {
  it('sweeps the chunks no head names reading the heads through the index of their upload, as before', async () => {
    const database = await entry.aDatabase();
    await anErasingLedger(entry, noteHolders, database);

    const plan = await entry.statementPlanOf(
      database,
      unnamedChunksSwept(keptShelf, uuidV7TimeOf(Date.now() - unnamedChunksLastMs)),
    );

    expect(plan).toContain(entry.throughTheUploadIndex);
  });
}

function erasedWhereverKept(entry: LedgerEntry): void {
  it('erases, through a store outside it, a content whose head stands in its own tables, its chunks there and its bytes in the store', async () => {
    const database = await entry.aDatabase();
    const own = await anErasingLedger(entry, noteHolders, database);
    const store = memoryContentStore();
    const content = await generated(2_500_000, 55);
    await at(keptAt, own.ledger.content.put(alpha, { ...content.content(), expiresAt: keptAt + aDay }));
    const outside = await anErasingLedgerOutside(entry, noteHolders, store, database);
    await at(keptAt + 1, outside.ledger.content.put(alpha, { ...content.content(), expiresAt: keptAt + aDay }));
    const held = async () => [
      await chunksHeldIn(entry, database, alpha, content.sha256),
      await resultOf(store.holds(alpha, content.sha256)),
    ];

    const beforeTheErasure = await held();
    const erased = await at(keptAt + aDay, outside.eraseExpired(10));

    expect([beforeTheErasure, erased, await held()]).toEqual([
      [true, true],
      { erased: 1, more: false },
      [false, false],
    ]);
    expect([
      (await resultOf(own.ledger.content.getHead(alpha, content.sha256)))?.erasedAt,
      await resultOf(own.ledger.content.get(alpha, content.sha256)),
      await resultOf(outside.ledger.content.get(alpha, content.sha256)),
    ]).toEqual([keptAt + aDay, undefined, undefined]);
  });
}

function namedNoPlaybook(entry: LedgerEntry): void {
  it('fails as a defect an erasure through a store outside it that meets a head of a key that names no playbook', async () => {
    const database = await entry.aDatabase();
    const { eraseExpired } = await anErasingLedgerOutside(entry, noteHolders, memoryContentStore(), database);
    await entry.queried(
      database,
      `INSERT INTO recorded_content_heads (playbook_key, sha256, upload_id, bytes, chunks, media_type, kept_in, expires_at)
        VALUES ('org/acme/', '${'a'.repeat(64)}', 'an upload', 1, 0, '${json}', 'external', ${keptAt})`,
    );

    const failed = await at(keptAt, defectOf(eraseExpired(10)));

    expect(failed).toEqual(new Error('A content head of org/acme/, which is not the key of a playbook, expires'));
  });
}

function removedOnceErased(entry: LedgerEntry): void {
  it('holds back a put, through a store outside it, that meets the removal of what is left of an erased content, and keeps the content as new once the removal is done', async () => {
    const paused = pausableStore(memoryContentStore());
    const { ledger, eraseExpired } = await anErasingLedgerOutside(entry, noteHolders, paused.store);
    const { sha256 } = await at(
      keptAt,
      ledger.content.put(alpha, { ...textToKeep(note, json), expiresAt: keptAt + 1 }),
    );
    await at(keptAt + 1, eraseExpired(10));
    const deleting = paused.pausedDelete();

    const removal = resultOf(ledger.removeUnheld(alpha, sha256));
    await deleting.reached;
    const put = resultOf(ledger.content.put(alpha, textToKeep(note, 'text/plain')));
    const settledBefore = await settledWithin(put, 300);
    deleting.release();

    expect([settledBefore, await removal, (await put).mediaType]).toEqual([false, 'removed', 'text/plain']);
    expect(await resultOf(ledger.content.getHead(alpha, sha256))).not.toHaveProperty('erasedAt');
  });
}

export function erasedChunksBehaviour(entry: LedgerEntry): void {
  describe('the chunks and the bytes of a content whose expiry has passed', () => {
    sweptOnceErased(entry);
    sweepsThroughTheUploadIndex(entry);
    keptAgainWhileErasing(entry);
    erasedWhereverKept(entry);
    namedNoPlaybook(entry);
    removedOnceErased(entry);
  });
}
