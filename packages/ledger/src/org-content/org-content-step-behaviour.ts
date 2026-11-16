import { sha256Of, textToKeep } from '@on.auto/content';
import { memoryContentStore, resultOf } from '@on.auto/content/testing';
import { heldNotes, noteHolders, type HeldNote } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { structureIn } from '../structure/database-structure-behaviour.ts';
import { contentTablesOfPlaybooks } from '../testing/content-tables-of-playbooks.ts';
import { aLedger, aLedgerHolding, aLedgerOutside, type LedgerEntry } from '../testing/ledger-entry.ts';
import {
  acmesOther,
  aHead,
  alpha,
  aStoreOfPlaybooksContent,
  beta,
  carryingToIt,
  chunkKept,
  countedIn,
  digest,
  earlier,
  elsewhere,
  gamma,
  globexsOther,
  headKept,
  headsIn,
  later,
  layoutBeforeSet,
  note,
  placesIn,
} from './content-of-playbooks.ts';
import { orgContentRefusalsBehaviour } from './org-content-refusals-behaviour.ts';

const HoldRows = Schema.Array(
  Schema.Struct({ org_key: Schema.String, playbook_key: Schema.String, stream: Schema.String, held: Schema.Number }),
);

function keptInTheLedger(entry: LedgerEntry): void {
  it("gives a content its org, one head for each org and digest, whose copy in the ledger's own chunks is the earliest whole one, kept as late as any, and kept for good where any copy was, every chunk left where it lay", async () => {
    const { database, made } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: alpha, upload: earlier, keptAt: 10, expiresAt: 100 });
    await headKept(entry, database, { key: beta, upload: later, keptAt: 20 });
    await headKept(entry, database, { key: gamma, upload: elsewhere, keptAt: 5, expiresAt: 50 });
    await chunkKept(entry, database, alpha, earlier);
    await chunkKept(entry, database, beta, later);
    await chunkKept(entry, database, gamma, elsewhere);

    await entry.carriedOn(database, carryingToIt);
    const heads = await headsIn(entry, database);
    const chunks = await countedIn(entry, database, 'recorded_content_chunks');
    const ledger = await aLedger(entry, database);
    const read = await Promise.all(
      [acmesOther, globexsOther].map(async (playbook) => (await resultOf(ledger.content.get(playbook, digest)))?.bytes),
    );

    expect(heads).toEqual([
      aHead({ org_key: 'org/acme/', place_key: alpha, upload_id: earlier, kept_at: 20 }),
      aHead({ org_key: 'org/globex/', place_key: gamma, upload_id: elsewhere, kept_at: 5, expires_at: 50 }),
    ]);
    expect([chunks, ...read]).toEqual([3, Buffer.byteLength(note), Buffer.byteLength(note)]);
    expect(await structureIn(entry, database)).toEqual(made);
  });
}

function wholeCopyChosen(entry: LedgerEntry): void {
  it("chooses a whole copy in the ledger's own chunks over an earlier one missing a chunk, so a content readable before is readable after", async () => {
    const { database } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: alpha, upload: earlier, keptAt: 10 });
    await headKept(entry, database, { key: beta, upload: later, keptAt: 20 });
    await chunkKept(entry, database, beta, later);

    await entry.carriedOn(database, carryingToIt);
    const ledger = await aLedger(entry, database);

    expect((await headsIn(entry, database)).map(({ place_key }) => place_key)).toEqual([beta]);
    expect((await resultOf(ledger.content.get(acmesOther, digest)))?.bytes).toBe(Buffer.byteLength(note));
  });
}

function keptOutsideItsLedger(entry: LedgerEntry): void {
  it('records every place a content kept outside the ledger lies at, so a read finds its bytes and a removal deletes them at each', async () => {
    const { database } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: alpha, upload: earlier, keptAt: 10, keptIn: 'external' });
    await headKept(entry, database, { key: beta, upload: later, keptAt: 20, keptIn: 'external' });
    const store = memoryContentStore();
    await Promise.all(
      [alpha, beta].map(async (place) => {
        const staged = await resultOf(store.stage(place, textToKeep(note, 'application/json')));
        await resultOf(staged.placed('application/json'));
      }),
    );

    await entry.carriedOn(database, carryingToIt);
    const places = await placesIn(entry, database);
    const ledger = await aLedgerOutside(entry, noteHolders, store, database);
    const read = (await resultOf(ledger.content.get(acmesOther, digest)))?.bytes;
    const removed = await resultOf(ledger.removeUnheld(acmesOther, digest));

    expect(places).toEqual([
      { org_key: 'org/acme/', sha256: digest, place_key: alpha },
      { org_key: 'org/acme/', sha256: digest, place_key: beta },
    ]);
    expect([read, removed]).toEqual([Buffer.byteLength(note), 'removed']);
    expect(await Promise.all([alpha, beta].map((place) => resultOf(store.holds(place, digest))))).toEqual([
      false,
      false,
    ]);
  });
}

function holdsCarried(entry: LedgerEntry): void {
  it('copies every hold to the next version of the holds, each under its org, records a place for a digest held with no head, and drops the version before', async () => {
    const database = await entry.aDatabase();
    await aLedgerHolding(entry, noteHolders, database);
    await contentTablesOfPlaybooks(entry, database);
    await entry.queried(database, 'DROP TABLE IF EXISTS content_references_2');
    await entry.queried(
      database,
      `CREATE TABLE content_references_1 (playbook_key TEXT NOT NULL, stream TEXT NOT NULL, sha256 TEXT NOT NULL,
        held INTEGER NOT NULL, PRIMARY KEY (playbook_key, stream, sha256))`,
    );
    await entry.queried(
      database,
      `INSERT INTO content_references_1 (playbook_key, stream, sha256, held)
        VALUES ('${alpha}', 'notes/n1', '${digest}', 2), ('${gamma}', 'notes/n2', '${digest}', 1)`,
    );
    await layoutBeforeSet(entry, database);

    await entry.carriedOn(database, carryingToIt);
    const holds = Schema.decodeUnknownSync(HoldRows)(
      await entry.queried(
        database,
        'SELECT org_key, playbook_key, stream, CAST(held AS INTEGER) AS held FROM content_references_2 ORDER BY stream',
      ),
    );
    const ledger = await aLedgerHolding(entry, noteHolders, database);

    expect(holds).toEqual([
      { org_key: 'org/acme/', playbook_key: alpha, stream: 'notes/n1', held: 2 },
      { org_key: 'org/globex/', playbook_key: gamma, stream: 'notes/n2', held: 1 },
    ]);
    expect((await placesIn(entry, database)).map(({ place_key }) => place_key)).toEqual([alpha, gamma]);
    expect(await resultOf(ledger.removeUnheld(acmesOther, digest))).toBe('held');
    expect(await tablesNamed(entry, database, 'content_references')).toEqual(['content_references_2']);
  });
}

const FoldedHoldRows = Schema.Array(
  Schema.Struct({
    org_key: Schema.String,
    playbook_key: Schema.String,
    stream: Schema.String,
    sha256: Schema.String,
    held: Schema.Number,
  }),
);

async function foldedHoldsIn(entry: LedgerEntry, database: string): Promise<typeof FoldedHoldRows.Type> {
  return Schema.decodeUnknownSync(FoldedHoldRows)(
    await entry.queried(
      database,
      `SELECT org_key, playbook_key, stream, sha256, CAST(held AS INTEGER) AS held FROM content_references_2
        ORDER BY playbook_key, stream, sha256`,
    ),
  );
}

function noteKept(sha256: string): HeldNote {
  return { type: 'note_kept', data: { sha256 } };
}

async function notesHoldingIn(entry: LedgerEntry, database: string): Promise<void> {
  const ledger = await aLedger(entry, database);
  const [kept, letGo] = [sha256Of('kept by two playbooks'), sha256Of('let go')];
  const noted = (stream: string, facts: readonly HeldNote[]) =>
    Effect.runPromise(ledger.execute(stream, heldNotes, facts));
  await noted(`${alpha}notes/n1`, [noteKept(kept), noteKept(kept), noteKept(letGo)]);
  await noted(`${beta}notes/n2`, [noteKept(letGo), { type: 'note_let_go', data: { sha256: letGo } }, noteKept(kept)]);
  await noted(`${gamma}notes/n3`, [noteKept(kept)]);
  await noted('org/acme/notes/n4', [noteKept(letGo)]);
}

async function holdsTakenBackToTheLayoutBefore(entry: LedgerEntry, database: string): Promise<void> {
  await entry.queried(
    database,
    `CREATE TABLE content_references_1 (playbook_key TEXT NOT NULL, stream TEXT NOT NULL, sha256 TEXT NOT NULL,
      held INTEGER NOT NULL, PRIMARY KEY (playbook_key, stream, sha256))`,
  );
  await entry.queried(
    database,
    `INSERT INTO content_references_1 (playbook_key, stream, sha256, held)
      SELECT playbook_key, stream, sha256, held FROM content_references_2`,
  );
  await contentTablesOfPlaybooks(entry, database);
  await layoutBeforeSet(entry, database);
}

function holdsEqualAFold(entry: LedgerEntry): void {
  it('carries holds equal, row for row, to the holds a fresh fold of the same facts makes, so the next version of the holds is what a rebuild would be', async () => {
    const database = await entry.aDatabase();
    await notesHoldingIn(entry, database);
    await aLedgerHolding(entry, noteHolders, database);
    await holdsTakenBackToTheLayoutBefore(entry, database);

    await entry.carriedOn(database, carryingToIt);
    const carried = await foldedHoldsIn(entry, database);
    await entry.queried(database, 'DROP TABLE content_references_2');
    await aLedgerHolding(entry, noteHolders, database);
    const folded = await foldedHoldsIn(entry, database);

    expect(carried).toEqual(folded);
    expect(carried.map(({ org_key, playbook_key, held }) => [org_key, playbook_key, held])).toEqual([
      ['org/acme/', alpha, 2],
      ['org/acme/', alpha, 1],
      ['org/acme/', beta, 1],
      ['org/globex/', gamma, 1],
    ]);
  });
}

async function tablesNamed(entry: LedgerEntry, database: string, prefix: string): Promise<readonly string[]> {
  const tables = await entry.executedOn(database, async (execute) => {
    const { rows } = await execute.query(entry.layout.tablesOfTheSchema());
    return Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(rows);
  });
  return tables.map(({ name }) => name).filter((name) => name.startsWith(prefix));
}

function marksAndExpiriesMerged(entry: LedgerEntry): void {
  it('keeps a content its copies kept, unmarked where any copy was, with the later expiry of the copies that stand, and erased only where every copy was', async () => {
    const { database } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: alpha, upload: earlier, keptAt: 10, removingSince: 15, expiresAt: 80 });
    await headKept(entry, database, { key: beta, upload: later, keptAt: 20, expiresAt: 90 });
    await headKept(entry, database, { key: gamma, upload: elsewhere, keptAt: 5, erasedAt: 7 });
    await headKept(entry, database, { key: 'playbook/globex/delta/', upload: earlier, keptAt: 6, erasedAt: 9 });
    await headKept(entry, database, { key: 'playbook/initech/one/', upload: '', keptAt: 0, removingSince: 3 });
    await headKept(entry, database, { key: 'playbook/initech/two/', upload: '', keptAt: 0, removingSince: 4 });

    await entry.carriedOn(database, carryingToIt);

    expect(await headsIn(entry, database)).toEqual([
      aHead({ org_key: 'org/acme/', place_key: alpha, upload_id: earlier, kept_at: 20, expires_at: 90 }),
      aHead({
        org_key: 'org/globex/',
        place_key: 'playbook/globex/delta/',
        upload_id: earlier,
        kept_at: 6,
        erased_at: 9,
      }),
      aHead({ org_key: 'org/initech/', place_key: 'playbook/initech/one/', removing_since: 4 }),
    ]);
  });

  it('keeps a mark where every copy that stands was marked, the later of their marks', async () => {
    const { database } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: alpha, upload: earlier, keptAt: 10, removingSince: 15, keptIn: 'external' });
    await headKept(entry, database, { key: beta, upload: later, keptAt: 20, removingSince: 25, keptIn: 'external' });

    await entry.carriedOn(database, carryingToIt);

    expect((await headsIn(entry, database)).map(({ removing_since }) => removing_since)).toEqual([25]);
  });
}

export function orgContentStepBehaviour(entry: LedgerEntry): void {
  describe("the step that gives a playbook's content to its org", () => {
    keptInTheLedger(entry);
    wholeCopyChosen(entry);
    keptOutsideItsLedger(entry);
    holdsCarried(entry);
    holdsEqualAFold(entry);
    marksAndExpiriesMerged(entry);
  });
  orgContentRefusalsBehaviour(entry);
}
