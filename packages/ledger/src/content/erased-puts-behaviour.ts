import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { keptOutside, type ContentStore, type ContentToKeep, type RecordedContent } from '@on.auto/content';
import {
  alpha,
  at,
  generated,
  memoryContentStore,
  octets,
  present,
  readBack,
  resultOf,
  type Generated,
} from '@on.auto/content/testing';
import { noteHolders } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { ReturningExecutor, StatementExecutor, UnlessHeld } from '../event-store.ts';
import { anErasingLedger, anErasingLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';
import { postgresqlContent, sqliteContent, type ContentDialect } from './content-dialects.ts';
import { contentStoreOn } from './content-store.ts';

const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

const aDay = 86_400_000;

const severalChunks = 2_500_000;

const contentDialects: Readonly<Record<LedgerEntry['layout']['dialect'], ContentDialect>> = {
  sqlite: sqliteContent,
  postgresql: postgresqlContent,
};

function until(content: ContentToKeep, expiresAt: number | undefined): ContentToKeep {
  return expiresAt === undefined ? content : { ...content, expiresAt };
}

function isAHeadWritten(sql: SQL): boolean {
  return SQL.describe(sql, sqliteFormatter).trimStart().startsWith('INSERT INTO recorded_content_heads');
}

function pausedAfterItsFirstHead(execute: StatementExecutor, held: () => Promise<void>): ReturningExecutor {
  let met = false;
  const run = async (sql: SQL) => {
    const answered = await execute.query(sql);
    const first = !met && isAHeadWritten(sql);
    met ||= first;
    if (first) {
      await held();
    }
    return answered;
  };
  return { query: run, command: run };
}

type Way = (generated: Generated) => ContentToKeep;

const whole: Way = ({ content }) => content();

const withItsDigest: Way = ({ sha256, content }) => ({ ...content(), expected: { sha256 } });

type Keeping = (
  execute: ReturningExecutor,
  dialect: ContentDialect,
  store: ContentStore,
  unlessHeld: UnlessHeld,
) => RecordedContent;

const keptInItsOwnTables: Keeping = (execute, dialect) => contentStoreOn(execute, dialect).content;

const keptOutsideIt: Keeping = (execute, dialect, store, unlessHeld) =>
  keptOutside(contentStoreOn(execute, dialect).externalHeadsWith(unlessHeld), store).content;

async function erasedOn(entry: LedgerEntry, outside: boolean, content: Generated) {
  const database = await entry.aDatabase();
  const store = memoryContentStore();
  const opened = await (outside
    ? anErasingLedgerOutside(entry, noteHolders, store, database)
    : anErasingLedger(entry, noteHolders, database));
  await at(keptAt, opened.ledger.content.put(alpha, { ...content.content(), expiresAt: keptAt + 1 }));
  await at(keptAt + aDay, opened.eraseExpired(10));
  return { database, store, ...opened };
}

interface Race {
  readonly outside: boolean;
  readonly keeping: Keeping;
  readonly held: number | undefined;
  readonly other: number | undefined;
}

const later = keptAt + 3 * aDay;

const races: readonly (readonly [string, Race])[] = [
  [
    'in its own tables, the put for good held',
    { outside: false, keeping: keptInItsOwnTables, held: undefined, other: later },
  ],
  [
    'in its own tables, the put with an expiry held',
    { outside: false, keeping: keptInItsOwnTables, held: later, other: undefined },
  ],
  ['outside it, the put for good held', { outside: true, keeping: keptOutsideIt, held: undefined, other: later }],
  ['outside it, the put with an expiry held', { outside: true, keeping: keptOutsideIt, held: later, other: undefined }],
];

async function raced(entry: LedgerEntry, { outside, keeping, held, other }: Race, content: Generated) {
  const erased = await erasedOn(entry, outside, content);
  const ledgerStore = entry.storeOn(erased.database);
  onTestFinished(() => ledgerStore.close());
  const [reached, resumed] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const holding = () => {
    reached.resolve();
    return resumed.promise;
  };
  const dialect = contentDialects[entry.layout.dialect];

  const first = entry.executedOn(erased.database, (execute) =>
    at(
      keptAt + 2 * aDay,
      keeping(pausedAfterItsFirstHead(execute, holding), dialect, erased.store, ledgerStore.unlessHeld).put(
        alpha,
        until(content.content(), held),
      ),
    ),
  );
  await reached.promise;
  await at(keptAt + 2 * aDay + 1, erased.ledger.content.put(alpha, until(content.content(), other)));
  resumed.resolve();
  await first;
  return erased;
}

function keptForGoodWhileRacing(entry: LedgerEntry): void {
  it.each(races)(
    'keeps for good a content erased %s after its first statement while the other put keeps the content whole',
    async (_how, race) => {
      const content = await generated(severalChunks, 71);

      const { ledger, eraseExpired } = await raced(entry, race, content);

      const head = await resultOf(ledger.content.getHead(alpha, content.sha256));
      expect([head?.expiresAt, head?.erasedAt]).toEqual([undefined, undefined]);
      expect(await at(keptAt + 10 * aDay, eraseExpired(10))).toEqual({ erased: 0, more: false });
      expect(await readBack(await present(ledger.content.get(alpha, content.sha256)))).toMatchObject({
        sha256: content.sha256,
        bytes: severalChunks,
      });
    },
  );
}

function keptOverAnErasedHeadOutside(entry: LedgerEntry): void {
  it.each([
    ['of one chunk, whole', 1000, whole],
    ['of several chunks, whole', severalChunks, whole],
    ['of several chunks, with its digest expected', severalChunks, withItsDigest],
  ])(
    'keeps in its own tables a content, %s, whose head a store outside it kept and erased, and reads it whole',
    async (_how, bytes, way) => {
      const content = await generated(bytes, 73);
      const { database } = await erasedOn(entry, true, content);
      const { ledger } = await anErasingLedger(entry, noteHolders, database);

      const kept = await at(keptAt + 2 * aDay, ledger.content.put(alpha, way(content)));

      expect(kept).toEqual({ sha256: content.sha256, bytes, mediaType: octets });
      expect(await resultOf(ledger.content.getHead(alpha, content.sha256))).toEqual({
        bytes,
        mediaType: octets,
        keptAt: keptAt + 2 * aDay,
      });
      expect(await readBack(await present(ledger.content.get(alpha, content.sha256)))).toMatchObject({
        sha256: content.sha256,
        bytes,
      });
    },
  );
}

export function erasedPutsBehaviour(entry: LedgerEntry): void {
  describe('the puts that meet a head whose content was erased', () => {
    keptForGoodWhileRacing(entry);
    keptOverAnErasedHeadOutside(entry);
  });
}
