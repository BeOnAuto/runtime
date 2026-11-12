import {
  mostContentChunkBytes,
  removalLastsMs,
  sha256Of,
  textToKeep,
  type ContentStore,
  type RecordedContent,
} from '@on.auto/content';
import {
  alpha,
  expiringContentBehaviour,
  interleavedErasureBehaviour,
  json,
  memoryContentStore,
  octets,
  resultOf,
  type ErasingContent,
  type ExpiringContentEntry,
} from '@on.auto/content/testing';
import { erasedContentBehaviour, noteHolders, type ErasingLedger } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { anErasingLedger, anErasingLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';
import type { OpenChores } from '../testing/open-ledger.ts';
import { ownExpiredRead } from './content-sweep.ts';
import { chunksHeldIn, erasedChunksBehaviour } from './erased-chunks-behaviour.ts';
import { expiredRead } from './external-heads.ts';

function erasingOf({ ledger, eraseExpired }: OpenChores): ErasingLedger {
  return { ledger, eraseExpired };
}

function keepingOf({ ledger, eraseExpired }: OpenChores): ErasingContent {
  return { content: ledger.content, eraseExpired };
}

function ownExpiringEntry(entry: LedgerEntry): ExpiringContentEntry {
  return {
    aStore: async () => {
      const database = await entry.aDatabase();
      const here = await anErasingLedger(entry, noteHolders, database);
      const elsewhere = await anErasingLedger(entry, noteHolders, database);
      return {
        ...keepingOf(here),
        elsewhere: keepingOf(elsewhere),
        bytesHeld: (playbook, sha256) => chunksHeldIn(entry, database, playbook, sha256),
      };
    },
  };
}

function outsideExpiringEntry(entry: LedgerEntry): ExpiringContentEntry {
  return {
    aStore: async () => {
      const database = await entry.aDatabase();
      const store = memoryContentStore();
      const here = await anErasingLedgerOutside(entry, noteHolders, store, database);
      const elsewhere = await anErasingLedgerOutside(entry, noteHolders, store, database);
      return {
        ...keepingOf(here),
        elsewhere: keepingOf(elsewhere),
        bytesHeld: (playbook, sha256) => resultOf(store.holds(playbook, sha256)),
      };
    },
  };
}

const oneChunk = '{"note":"kept in one chunk"}';

const severalChunks = 'x'.repeat(2 * mostContentChunkBytes + 1);

const CountedRows = Schema.Array(Schema.Struct({ updates: Schema.Number }));

async function uploadUpdatesCounted(entry: LedgerEntry, database: string): Promise<() => Promise<number>> {
  await entry.updatesCountingOf('recorded_content_heads', 'upload_id').reduce(async (before, statement) => {
    await before;
    await entry.queried(database, statement);
  }, Promise.resolve());
  return async () =>
    Schema.decodeUnknownSync(CountedRows)(
      await entry.queried(database, 'SELECT CAST(COUNT(*) AS INTEGER) AS updates FROM counted_updates'),
    ).reduce((counted, { updates }) => counted + updates, 0);
}

async function keptBoth(content: RecordedContent): Promise<void> {
  await resultOf(content.put(alpha, textToKeep(oneChunk, json)));
  await resultOf(content.put(alpha, textToKeep(severalChunks, octets)));
}

async function keptAgainHeld(content: RecordedContent): Promise<void> {
  await resultOf(content.put(alpha, textToKeep(oneChunk, json)));
  await resultOf(
    content.put(alpha, { ...textToKeep(severalChunks, octets), expected: { sha256: sha256Of(severalChunks) } }),
  );
}

function setsNoUploadOfAHeadThatStands(entry: LedgerEntry): void {
  it('sets the upload of no head of its own that stands, kept again in one chunk or with its digest expected, and only a put whole of several chunks names it, to take the head over where a removal took it, as before', async () => {
    const database = await entry.aDatabase();
    const { ledger } = await anErasingLedger(entry, noteHolders, database);
    await keptBoth(ledger.content);
    const counted = await uploadUpdatesCounted(entry, database);

    await keptAgainHeld(ledger.content);
    const held = await counted();
    await resultOf(ledger.content.put(alpha, textToKeep(severalChunks, octets)));

    expect([held, await counted()]).toEqual([0, 1]);
  });

  it('sets the upload of no head that stands through a store outside it, kept again whole or with its digest expected', async () => {
    const database = await entry.aDatabase();
    const { ledger } = await anErasingLedgerOutside(entry, noteHolders, memoryContentStore(), database);
    await keptBoth(ledger.content);
    const counted = await uploadUpdatesCounted(entry, database);

    await keptBoth(ledger.content);
    await keptAgainHeld(ledger.content);

    expect(await counted()).toBe(0);
  });
}

function readThroughTheIndex(entry: LedgerEntry): void {
  it('reads the heads that are due through the partial index of the heads that expire, in its order, needing no scan of the table and no sort, for its own content and for a store outside it', async () => {
    const database = await entry.aDatabase();
    await anErasingLedger(entry, noteHolders, database);
    const now = Date.now();

    const plans = [
      await entry.statementPlanOf(database, ownExpiredRead(now, 100)),
      await entry.statementPlanOf(database, expiredRead({ now, staleBefore: now - removalLastsMs }, 100)),
    ];

    expect(plans).toEqual([
      expect.stringContaining(entry.throughTheExpiringIndex),
      expect.stringContaining(entry.throughTheExpiringIndex),
    ]);
    expect(plans.filter((plan) => entry.stepsOfAScanOrASort.some((step) => plan.includes(step)))).toEqual([]);
  });
}

export function expiredHeadsBehaviour(entry: LedgerEntry): void {
  describe('the ledger whose content expires, kept in its own tables', () => {
    expiringContentBehaviour(ownExpiringEntry(entry));
    erasedContentBehaviour({ aLedger: async (holders) => erasingOf(await anErasingLedger(entry, holders)) });
  });
  describe('the ledger whose content expires, kept in a store outside it', () => {
    expiringContentBehaviour(outsideExpiringEntry(entry));
    erasedContentBehaviour({
      aLedger: async (holders) => erasingOf(await anErasingLedgerOutside(entry, holders, memoryContentStore())),
    });
    interleavedErasureBehaviour({
      aStore: () => Promise.resolve<ContentStore>(memoryContentStore()),
      aKeeping: async (store) => {
        const database = await entry.aDatabase();
        const here = await anErasingLedgerOutside(entry, noteHolders, store, database);
        const elsewhere = await anErasingLedgerOutside(entry, noteHolders, store, database);
        return { ...keepingOf(here), elsewhere: keepingOf(elsewhere) };
      },
    });
  });
  describe('the heads of the content that expires', () => {
    readThroughTheIndex(entry);
    setsNoUploadOfAHeadThatStands(entry);
    erasedChunksBehaviour(entry);
  });
}
