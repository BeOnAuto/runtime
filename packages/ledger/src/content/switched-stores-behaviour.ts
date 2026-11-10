import { sha256Of, textToKeep } from '@on.auto/content';
import { alpha, at, json, keptTextOf, memoryContentStore, present, resultOf } from '@on.auto/content/testing';
import { noteHolders } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedgerHolding, aLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const anHourAndMore = 2 * 3_600_000;

const HeadRows = Schema.Array(Schema.Struct({ kept_in: Schema.String, chunks: Schema.Number }));

const first = '{"kept":"first"}';

const second = '{"kept":"second"}';

function headsOf(entry: LedgerEntry, database: string, text: string): Promise<unknown> {
  return entry
    .queried(database, `SELECT kept_in, chunks FROM recorded_content_heads WHERE sha256 = '${sha256Of(text)}'`)
    .then((rows) => Schema.decodeUnknownSync(HeadRows)(rows));
}

function backToItsOwnTables(entry: LedgerEntry): void {
  it('reads nothing of what a store outside it kept once it keeps its content itself, keeps it again in its own tables whole or by its digest, and reads the store again once given it again, with the media type of the head it took over', async () => {
    const database = await entry.aDatabase();
    const store = memoryContentStore();
    const outside = await aLedgerOutside(entry, noteHolders, store, database);
    await at(keptAt, outside.content.put(alpha, textToKeep(first, 'text/plain')));
    await at(keptAt, outside.content.put(alpha, textToKeep(second, json)));

    const own = await aLedgerHolding(entry, noteHolders, database);
    const unread = await keptTextOf(own.content, alpha, sha256Of(first));
    await resultOf(own.content.put(alpha, { ...textToKeep(first, json), expected: { sha256: sha256Of(first) } }));
    await resultOf(own.content.put(alpha, textToKeep(second, json)));
    const keptAgain = [
      await keptTextOf(own.content, alpha, sha256Of(first)),
      await keptTextOf(own.content, alpha, sha256Of(second)),
    ];
    const heads = [await headsOf(entry, database, first), await headsOf(entry, database, second)];
    const outsideAgain = await aLedgerOutside(entry, noteHolders, store, database);

    expect([unread, keptAgain]).toEqual([undefined, [first, second]]);
    expect(heads).toEqual([[{ kept_in: 'ledger', chunks: 1 }], [{ kept_in: 'ledger', chunks: 1 }]]);
    expect(await keptTextOf(outsideAgain.content, alpha, sha256Of(first))).toBe(first);
    expect([
      (await present(outsideAgain.content.get(alpha, sha256Of(first)))).mediaType,
      (await resultOf(outsideAgain.content.put(alpha, textToKeep(first, 'text/plain')))).mediaType,
    ]).toEqual([json, json]);
  });
}

function outToAStore(entry: LedgerEntry): void {
  it('reads nothing of what it kept in its own tables once given a store outside it, keeps it again there, and removes it there', async () => {
    const database = await entry.aDatabase();
    const own = await aLedgerHolding(entry, noteHolders, database);
    await at(keptAt, own.content.put(alpha, textToKeep(first, json)));
    const store = memoryContentStore();

    const outside = await aLedgerOutside(entry, noteHolders, store, database);
    const unread = await keptTextOf(outside.content, alpha, sha256Of(first));
    await at(keptAt, outside.content.put(alpha, textToKeep(first, json)));
    const keptAgain = await keptTextOf(outside.content, alpha, sha256Of(first));
    const removed = await at(keptAt + anHourAndMore, outside.removeUnheld(alpha, sha256Of(first)));

    expect([unread, keptAgain, removed]).toEqual([undefined, first, 'removed']);
    expect(await resultOf(store.read(alpha, sha256Of(first)))).toBeUndefined();
    expect(await headsOf(entry, database, first)).toEqual([]);
  });
}

function headsWhereKept(entry: LedgerEntry): void {
  it('answers the head of a content where it is kept, with when a put last kept it, and none in its own tables for a content a store outside it keeps', async () => {
    const database = await entry.aDatabase();
    const outside = await aLedgerOutside(entry, noteHolders, memoryContentStore(), database);
    await at(keptAt, outside.content.put(alpha, textToKeep(first, json)));
    const own = await aLedgerHolding(entry, noteHolders, database);
    await at(keptAt + anHourAndMore, own.content.put(alpha, textToKeep(second, json)));

    const heads = [
      await resultOf(outside.content.getHead(alpha, sha256Of(first))),
      await resultOf(own.content.getHead(alpha, sha256Of(first))),
      await resultOf(own.content.getHead(alpha, sha256Of(second))),
    ];

    expect(heads).toEqual([
      { bytes: first.length, mediaType: json, keptAt },
      undefined,
      { bytes: second.length, mediaType: json, keptAt: keptAt + anHourAndMore },
    ]);
  });
}

export function switchedStoresBehaviour(entry: LedgerEntry): void {
  describe('a ledger whose content moves between its own tables and a store outside it', () => {
    backToItsOwnTables(entry);
    outToAStore(entry);
    headsWhereKept(entry);
  });
}
