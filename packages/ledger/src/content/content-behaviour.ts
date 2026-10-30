import { mostContentChunkBytes, sha256Of, textOfContent, textToKeep, type Ledger } from '@on.auto/operations';
import {
  alpha,
  answerOfAbout,
  deliveredBeforeFailing,
  generated,
  json,
  octets,
  present,
  readBack,
  recordedContentBehaviour,
  resultOf,
  type ContentEntry,
} from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { unnamedChunksSwept } from './unnamed-chunks-behaviour.ts';

const ChunkRows = Schema.Array(Schema.Struct({ chunk: Schema.Number, bytes: Schema.Number }));

const HeadRows = Schema.Array(
  Schema.Struct({ sha256: Schema.String, bytes: Schema.Number, chunks: Schema.Number, media_type: Schema.String }),
);

const CountRows = Schema.Array(Schema.Struct({ count: Schema.Number }));

function chunkSizesOf(bytes: number): readonly number[] {
  return Array.from({ length: Math.ceil(bytes / mostContentChunkBytes) }, (_, index) =>
    Math.min(mostContentChunkBytes, bytes - index * mostContentChunkBytes),
  );
}

function chunksOfTheDigest(sha256: string): string {
  return `SELECT c.chunk, octet_length(c.data) AS bytes FROM recorded_content_chunks c
    JOIN recorded_content_heads h ON h.playbook_key = c.playbook_key AND h.upload_id = c.upload_id
    WHERE h.sha256 = '${sha256}' ORDER BY c.chunk`;
}

const theHeads =
  'SELECT sha256, CAST(bytes AS DOUBLE PRECISION) AS bytes, chunks, media_type FROM recorded_content_heads ORDER BY sha256';

const unnamedChunks = [
  `SELECT CAST(count(*) AS INTEGER) AS count FROM recorded_content_chunks c WHERE NOT EXISTS (
    SELECT 1 FROM recorded_content_heads h WHERE h.playbook_key = c.playbook_key AND h.upload_id = c.upload_id)`,
  `SELECT CAST(count(*) AS INTEGER) AS count FROM staged_content_chunks c WHERE NOT EXISTS (
    SELECT 1 FROM staged_content h WHERE h.playbook_key = c.playbook_key AND h.run_id = c.run_id AND h.upload_id = c.upload_id)`,
];

const notItsBytes = (sha256: string) =>
  new Error(`The content kept under ${sha256} is not the bytes that digest names`);

async function unnamedChunksIn(entry: LedgerEntry, database: string): Promise<number> {
  const counts = await Promise.all(
    unnamedChunks.map(async (statement) =>
      Schema.decodeUnknownSync(CountRows)(await entry.queried(database, statement)),
    ),
  );
  return counts.flat().reduce((total, { count }) => total + count, 0);
}

function contentEntryOf(entry: LedgerEntry): ContentEntry {
  return {
    aStore: async () => {
      const database = await entry.aDatabase();
      const writing = await aLedger(entry, database);
      const reading = await aLedger(entry, database);
      return {
        content: writing.content,
        elsewhere: reading.content,
        unnamedLeft: () => unnamedChunksIn(entry, database),
      };
    },
  };
}

async function opened(entry: LedgerEntry) {
  const database = await entry.aDatabase();
  return { database, ledger: await aLedger(entry, database) };
}

function readAsText(ledger: Ledger['Service'], sha256: string): Promise<string> {
  return resultOf(
    Effect.flatMap(Effect.flatMap(ledger.content.get(alpha, sha256), Effect.fromNullishOr), textOfContent),
  );
}

function keptInChunks(entry: LedgerEntry): void {
  it.each([
    ['no bytes', 0],
    ['100 bytes', 100],
    ['5 MB', 5_000_000],
  ])(
    'keeps %s in chunks of 1 MiB under a head written last, and reads them back a chunk at a time',
    async (_size, bytes) => {
      const { database, ledger } = await opened(entry);
      const { sha256, content } = await generated(bytes);

      await resultOf(ledger.content.put(alpha, content()));
      const chunks = Schema.decodeUnknownSync(ChunkRows)(await entry.queried(database, chunksOfTheDigest(sha256)));
      const heads = Schema.decodeUnknownSync(HeadRows)(await entry.queried(database, theHeads));
      const read = await readBack(await resultOf(ledger.content.get(alpha, sha256)));

      expect(read?.largestPiece).toBe(Math.min(bytes, mostContentChunkBytes));
      expect(heads).toEqual([{ sha256, bytes, chunks: chunks.length, media_type: octets }]);
      expect(chunks).toEqual(chunkSizesOf(bytes).map((size, chunk) => ({ chunk, bytes: size })));
    },
  );
}

async function copiedUnder(entry: LedgerEntry, database: string, from: string, to: string): Promise<void> {
  await entry.queried(
    database,
    `INSERT INTO recorded_content_heads (playbook_key, sha256, upload_id, bytes, chunks, media_type)
      SELECT playbook_key, '${to}', upload_id, bytes, chunks, media_type FROM recorded_content_heads WHERE sha256 = '${from}'`,
  );
}

function readFailing(entry: LedgerEntry): void {
  it('fails as a defect on a read whose chunk is missing, after the chunks before it', async () => {
    const { database, ledger } = await opened(entry);
    const { sha256 } = await resultOf(ledger.content.put(alpha, textToKeep(answerOfAbout(2_500_000), json)));

    await entry.queried(database, 'DELETE FROM recorded_content_chunks WHERE chunk = 1');
    const delivered = await deliveredBeforeFailing((await present(ledger.content.get(alpha, sha256))).stream);

    expect(delivered).toEqual({
      bytes: mostContentChunkBytes,
      failure: new Error(`The content kept under ${sha256} is missing its chunk 1`),
    });
    await expect(readAsText(ledger, sha256)).rejects.toThrow(`The content kept under ${sha256} is missing its chunk 1`);
  });

  it('hands over no chunk of a read whose bytes are not those its digest names, before checking them', async () => {
    const { database, ledger } = await opened(entry);
    const { sha256: small } = await resultOf(ledger.content.put(alpha, textToKeep('{"a":1}', json)));
    const { sha256: large } = await resultOf(ledger.content.put(alpha, textToKeep(answerOfAbout(2_500_000), json)));
    const [oneChunk, threeChunks] = [sha256Of('one chunk'), sha256Of('three chunks')];
    await copiedUnder(entry, database, small, oneChunk);
    await copiedUnder(entry, database, large, threeChunks);

    const delivered = await Promise.all(
      [oneChunk, threeChunks].map(async (sha256) =>
        deliveredBeforeFailing((await present(ledger.content.get(alpha, sha256))).stream),
      ),
    );

    expect(delivered).toEqual([
      { bytes: 0, failure: notItsBytes(oneChunk) },
      { bytes: 2 * mostContentChunkBytes, failure: notItsBytes(threeChunks) },
    ]);
  });
}

function readWhileUnstaged(entry: LedgerEntry): void {
  it('fails a read of a staged content whose run is unstaged while it is read, in words that say so', async () => {
    const ledger = await aLedger(entry);
    const { sha256, content } = await generated(2_500_000);
    await resultOf(ledger.content.stage(alpha, 'run-1', content()));

    const staged = await present(ledger.content.staged(alpha, 'run-1', sha256));
    await resultOf(ledger.content.unstage(alpha, 'run-1'));
    const { bytes, failure } = await deliveredBeforeFailing(staged.stream);

    expect([0, mostContentChunkBytes]).toContain(bytes);
    expect(failure).toEqual(
      new Error(
        `The content staged under ${sha256} has no chunk ${bytes / mostContentChunkBytes}, as when its run is unstaged while it is read`,
      ),
    );
  });
}

export function contentBehaviour(entry: LedgerEntry): void {
  recordedContentBehaviour(contentEntryOf(entry));
  describe('the content a playbook recorded, in chunks', () => {
    keptInChunks(entry);
  });
  describe('the content a playbook recorded, read back', () => {
    readFailing(entry);
    readWhileUnstaged(entry);
  });
  unnamedChunksSwept(entry);
}
