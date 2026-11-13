import { textToKeep } from '@on.auto/content';
import type { LedgerPorts } from '@on.auto/operations';
import { noteHolders, writtenNotes, type WrittenNote } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { aLedgerHolding, type LedgerEntry } from '../testing/ledger-entry.ts';
import { recordedPayloadMetadataOf } from './payload-metadata.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const firstWritings = 'playbook/acme/alpha/writings/w1';

const fourMiB = 4 * 1024 * 1024;

const MetadataRows = Schema.Array(
  Schema.Struct({
    metadata: Schema.Union([Schema.fromJsonString(Schema.JsonObject), Schema.JsonObject]),
  }),
);

const HeldRows = Schema.Array(Schema.Struct({ sha256: Schema.String, held: Schema.Number }));

function written(data: Extract<WrittenNote, { readonly type: 'note_written' }>['data']): WrittenNote {
  return { type: 'note_written', data };
}

function wrote(ledger: LedgerPorts, stream: string, ...facts: readonly WrittenNote[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, writtenNotes, facts));
}

function keptIn(ledger: LedgerPorts, text: string): Promise<string> {
  return Effect.runPromise(
    Effect.map(ledger.content.put(alpha, textToKeep(text, 'application/json')), (kept) => kept.sha256),
  );
}

const keptByEmmett: ReadonlySet<string> = new Set(['messageId', 'streamName', 'streamPosition', 'traceId', 'spanId']);

async function metadataOf(entry: LedgerEntry, database: string): Promise<readonly Schema.JsonObject[]> {
  const rows = await entry.queried(
    database,
    `SELECT message_metadata AS metadata FROM emt_messages WHERE stream_id = '${firstWritings}' ORDER BY stream_position`,
  );
  return Schema.decodeUnknownSync(MetadataRows)(rows).map(({ metadata }) =>
    Object.fromEntries(
      Object.entries(metadata).filter(([member]: readonly [string, unknown]) => !keptByEmmett.has(member)),
    ),
  );
}

const StoredTextRows = Schema.Array(Schema.Struct({ metadata: Schema.String }));

function withItsIdsNormalised(text: string): string {
  return text.replaceAll(/("(?:messageId|traceId|spanId)": ?)"[^"]*"/gu, '$1"…"');
}

async function storedMetadataOf(entry: LedgerEntry, database: string): Promise<readonly string[]> {
  const rows = await entry.queried(
    database,
    `SELECT CAST(message_metadata AS TEXT) AS metadata FROM emt_messages WHERE stream_id = '${firstWritings}' ORDER BY stream_position`,
  );
  return Schema.decodeUnknownSync(StoredTextRows)(rows).map(({ metadata }) => withItsIdsNormalised(metadata));
}

function erasing(position: number, data: Schema.JsonObject) {
  return {
    eventSchema: writtenNotes.eventSchema,
    data,
    erasure: { type: 'note_erased' as const, data: { position } },
    context: { at: '2026-11-02T09:00:00.000Z', by: 'eraser' },
  };
}

function measuredInItsMetadata(entry: LedgerEntry): void {
  it('names the bytes they hold in the metadata of a fact that offloads payloads, and in no other, in the shape recorded', async () => {
    const database = await entry.aDatabase();
    const ledger = await aLedgerHolding(entry, noteHolders, database);
    const sha256 = await keptIn(ledger, '{"note":"the first"}');

    await wrote(
      ledger,
      firstWritings,
      written({ body_sha256: sha256, body_bytes: 4096, parts: [{ sha256, bytes: 3000 }] }),
      written({ body: 'inline' }),
      written({ parts: [] }),
      { type: 'note_kept', data: { sha256 } },
    );

    expect(await storedMetadataOf(entry, database)).toEqual(recordedPayloadMetadataOf(entry.layout.dialect));
  });

  it('rewrites the bytes a scrubbed fact keeps outside with its data, and takes them away when it keeps none', async () => {
    const database = await entry.aDatabase();
    const ledger = await aLedgerHolding(entry, noteHolders, database);
    const sha256 = await keptIn(ledger, '{"note":"the first"}');
    await wrote(ledger, firstWritings, written({ body_sha256: sha256, body_bytes: 4096 }), written({ body: 'inline' }));

    await Effect.runPromise(ledger.scrubFact(firstWritings, 1, erasing(1, { body: 'erased' })));
    await Effect.runPromise(ledger.scrubFact(firstWritings, 2, erasing(2, { body_sha256: sha256, body_bytes: 12 })));

    expect((await metadataOf(entry, database)).map((metadata) => metadata['payloadBytes'])).toEqual([
      undefined,
      12,
      undefined,
      undefined,
    ]);
  });
}

function refilledInBoundedBatches(entry: LedgerEntry): void {
  it('fills the holds again from the facts that keep payloads, in batches of 16 MiB of their true size, and holds the inline ones not at all', async () => {
    const database = await entry.aDatabase();
    const before = await aLedgerHolding(entry, noteHolders, database);
    const sha256 = await keptIn(before, '{"note":"held five times"}');
    const kept = written({ body_sha256: sha256, body_bytes: fourMiB });
    await wrote(before, firstWritings, kept, kept, kept, written({ body: 'inline' }));
    await wrote(before, firstWritings, kept, kept, { type: 'note_kept', data: { sha256 } });
    await entry.queried(database, 'DROP TABLE content_references_1');

    const after = await aLedgerHolding(entry, noteHolders, database);

    expect(
      Schema.decodeUnknownSync(HeldRows)(
        await entry.queried(database, 'SELECT sha256, CAST(held AS INTEGER) AS held FROM content_references_1'),
      ),
    ).toEqual([{ sha256, held: 6 }]);
    expect(await Effect.runPromise(after.removeUnheld(alpha, sha256))).toBe('held');
  });
}

function readInPages(entry: LedgerEntry): void {
  it('reads a stream a page at a time by the true size of its facts, at least one a page, and says where each ends and whether more follow', async () => {
    const database = await entry.aDatabase();
    const ledger = await aLedgerHolding(entry, noteHolders, database);
    const sha256 = await keptIn(ledger, '{"note":"paged"}');
    const big = written({ body_sha256: sha256, body_bytes: 3 * 1024 * 1024 });
    await wrote(ledger, firstWritings, big, written({ body: 'small' }), big);
    const store = entry.storeOn(database);
    onTestFinished(() => store.close());

    const pages = [
      await store.readPage(firstWritings, 0, fourMiB),
      await store.readPage(firstWritings, 2, fourMiB),
      await store.readPage(firstWritings, 3, fourMiB),
    ];

    expect(pages.map(({ messages, through, more }) => [messages.length, through, more])).toEqual([
      [2, 2, true],
      [1, 3, false],
      [0, 3, false],
    ]);
    expect(pages[0]?.messages.map(({ type }) => type)).toEqual(['note_written', 'note_written']);
  });
}

export function payloadBytesBehaviour(entry: LedgerEntry): void {
  describe('the true size of a fact, the bytes of its data and of the payloads it keeps outside', () => {
    measuredInItsMetadata(entry);
    refilledInBoundedBatches(entry);
    readInPages(entry);
  });
}
