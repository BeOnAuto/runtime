import { textToKeep, type ContentToKeep } from '@on.auto/content';
import { at, json } from '@on.auto/content/testing';
import { heldNotes, writtenNotes } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { statement } from '../connection/statement.ts';
import type { OpenedLedgerFile } from './opened-ledger-file.ts';
import {
  alpha,
  keptBy,
  keptOutside,
  longAfter,
  pinnedContents,
  pinnedMoment,
  pinnedSecrets,
  pinnedStreams,
  valuesKeptBeside,
} from './pinned-scenario.ts';

function kept({ ledger }: OpenedLedgerFile, content: ContentToKeep) {
  return at(pinnedMoment, ledger.content.put(alpha, content));
}

export async function contentKeptOutside(open: OpenedLedgerFile): Promise<void> {
  await kept(open, textToKeep(keptOutside, json));
}

export async function contentKept(open: OpenedLedgerFile): Promise<void> {
  const held = await kept(open, textToKeep(pinnedContents.held, json));
  const payload = await kept(open, textToKeep(pinnedContents.payload, json));
  await kept(open, { ...textToKeep(pinnedContents.expiring, json), expiresAt: longAfter });
  await kept(open, { ...textToKeep(pinnedContents.erased, json), expiresAt: pinnedMoment + 1000 });
  await Effect.runPromise(
    open.ledger.execute(pinnedStreams.held, heldNotes, [{ type: 'note_kept', data: { sha256: held.sha256 } }]),
  );
  await Effect.runPromise(
    open.ledger.execute(pinnedStreams.written, writtenNotes, [
      { type: 'note_written', data: { body_sha256: payload.sha256, body_bytes: payload.bytes } },
    ]),
  );
  await at(pinnedMoment + 2000, open.chores.eraseExpired(10));
}

export async function keptBeside({ connection }: OpenedLedgerFile): Promise<void> {
  await connection.migrated([
    statement`CREATE TABLE IF NOT EXISTS kept_beside (place INTEGER NOT NULL PRIMARY KEY, as_integer INTEGER, as_bigint BIGINT, as_real REAL, as_numeric NUMERIC, as_boolean BOOLEAN, as_text TEXT, as_blob BLOB, untyped)`,
  ]);
  await connection.transaction(
    valuesKeptBeside.map(
      (value, place) =>
        statement`INSERT INTO kept_beside (place, as_integer, as_bigint, as_real, as_numeric, as_boolean, as_text, as_blob, untyped)
          VALUES (${place}, ${value}, ${value}, ${value}, ${value}, ${value}, ${value}, ${value}, ${value})`,
    ),
  );
}

export async function rowsOfTheirOwn({ secretRows, receivedWebhooks }: OpenedLedgerFile): Promise<void> {
  const sealed = { keptBy, held: 'c2VhbGVkIGJ5IG5vYm9keQ', wrappedKey: 'd3JhcHBlZCBieSBub2JvZHk', kid: 'key-1' };
  await at(pinnedMoment, secretRows.keep(pinnedSecrets.sealed, sealed, 'wxyz'));
  await at(pinnedMoment, secretRows.claim(pinnedSecrets.sealed, 1, 60_000));
  await at(pinnedMoment, secretRows.keep(pinnedSecrets.plain, { keptBy, held: 'aGVsZCBwbGFpbg' }));
  await at(
    pinnedMoment,
    receivedWebhooks.taken({
      org: 'acme',
      connection: 'c1',
      webhookId: 'w1',
      takenFor: pinnedStreams.endedRun,
      keptUntilMs: longAfter,
    }),
  );
}

export async function checkpointed({ connection }: OpenedLedgerFile): Promise<void> {
  await connection.write(statement`PRAGMA wal_checkpoint(PASSIVE)`);
}
