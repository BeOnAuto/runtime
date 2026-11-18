import type { KeptProjection, Ledger, ProjectedRowsQuery } from '@on.auto/operations';
import {
  labelFacts,
  labelRows,
  remarkFacts,
  remarkRows,
  runFacts,
  runTallyRows,
  tallyRowsOf,
  topicFacts,
  topicRows,
  type LabelFact,
  type RemarkFact,
  type RunFact,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { loggingLayerOf } from '../projection-checkpoints/logged-opening.ts';
import { caughtUpAt, checkpointsOfTheTallies } from '../projection-checkpoints/projection-checkpoints-behaviour.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';

type AnyLedger = Ledger['Service'];

const addresses = [{ org: 'acme', playbook: 'alpha' }, { org: 'acme' }] as const;

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

const breakingDown = 'The projection broke down';

const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };

const noted: RunFact = { type: 'run_noted', data: {} };

const failed: RunFact = { type: 'run_ended', data: { status: 'failed', ms: 10, tokens: null } };

const failingOnAFailure = (version: number) => tallyRowsOf(version, (row) => row['status'] === 'failed');

function inPages(entry: LedgerEntry, database: string, projections: readonly KeptProjection[]) {
  return entry.ledgerOn(database, undefined, projections, { mostBytesFilledAtOnce: 1 });
}

async function openedInPages(
  entry: LedgerEntry,
  database: string,
  projections: readonly KeptProjection[],
): Promise<AnyLedger> {
  const { ledger, dispose } = await openLedgerWith(inPages(entry, database, projections));
  onTestFinished(dispose);
  return ledger;
}

function ran(ledger: AnyLedger, run: string, ...facts: readonly RunFact[]) {
  return Effect.runPromise(ledger.execute(`playbook/acme/alpha/runs/${run}`, runFacts, facts));
}

function topic(ledger: AnyLedger, stream: string, ...facts: readonly TopicFact[]) {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

function labelled(ledger: AnyLedger, stream: string, ...facts: readonly LabelFact[]) {
  return Effect.runPromise(ledger.execute(stream, labelFacts, facts));
}

function remarked(ledger: AnyLedger, stream: string, ...facts: readonly RemarkFact[]) {
  return Effect.runPromise(ledger.execute(stream, remarkFacts, facts));
}

function rowsOf(ledger: AnyLedger, names: readonly string[]) {
  return Promise.all(
    names.flatMap((name) =>
      addresses.map((address) => Effect.runPromise(ledger.readProjectedRows(name, address, everyRow))),
    ),
  );
}

async function talliedHistory(ledger: AnyLedger): Promise<void> {
  await ran(ledger, 'r1', began, noted, noted);
  await ran(ledger, 'r2', began, failed);
  await ran(ledger, 'r3', began);
}

const tallies = 'SELECT row_key, facts FROM run_tallies_2 ORDER BY row_key';

function aFillCutOff(entry: LedgerEntry): void {
  it('fails the opening where a fold throws, logging an error with the position alone, keeps every page before it, and is carried on from that position at the next opening, counting no fact twice', async () => {
    const database = await entry.aDatabase();
    const inline = await openedInPages(entry, database, [runTallyRows]);
    await talliedHistory(inline);
    const kept = await rowsOf(inline, ['run_tallies']);
    await entry.queried(database, 'DROP TABLE run_tallies_2');
    const failing = loggingLayerOf(inPages(entry, database, [failingOnAFailure(2)]));

    await expect(openLedgerWith(failing.layer)).rejects.toThrow(breakingDown);
    const cutOff = [await entry.queried(database, checkpointsOfTheTallies), await entry.queried(database, tallies)];
    const carriedOn = await openedInPages(entry, database, [runTallyRows]);

    expect(failing.logged).toEqual([{ level: 'ERROR', annotations: { position: '4' } }]);
    expect(cutOff).toEqual([
      [{ projection: 'run_tallies', version: 2, folded_through: '4' }],
      [
        { row_key: 'r1', facts: 3 },
        { row_key: 'r2', facts: 1 },
      ],
    ]);
    expect(await rowsOf(carriedOn, ['run_tallies'])).toEqual(kept);
    expect(await entry.queried(database, checkpointsOfTheTallies)).toEqual([caughtUpAt(2)]);
  });
}

const fourKinds: readonly KeptProjection[] = [runTallyRows, topicRows, labelRows, remarkRows];

const theirNames = ['run_tallies', 'topics', 'labels', 'remarks'];

async function aHistoryOfFourKinds(ledger: AnyLedger): Promise<void> {
  await ran(ledger, 'r1', began, noted);
  await topic(ledger, 'playbook/acme/alpha/runs/r9', { type: 'topic_opened', data: { topic: 'spring', at: 1000 } });
  await labelled(ledger, 'playbook/acme/alpha/notes/n1', {
    type: 'labels_set',
    data: { note: 'n1', labels: ['urgent', 'billing'] },
  });
  await remarked(ledger, 'org/acme/remarks/m1', { type: 'remark_made', data: { text: 'of acme' } });
  await topic(ledger, 'playbook/acme/alpha/notes/n2', {
    type: 'topic_noted',
    data: { topic: 'spring', note: 'first' },
  });
  await remarked(ledger, 'playbook/acme/alpha/remarks/m2', { type: 'remark_made', data: { text: 'of alpha' } });
  await ran(ledger, 'r1', failed);
  await labelled(ledger, 'playbook/acme/alpha/notes/n1', { type: 'label_added', data: { note: 'n1', label: 'late' } });
  await remarked(ledger, 'org/acme/remarks/m1', { type: 'remark_made', data: { text: 'again' } });
  await topic(ledger, 'playbook/acme/alpha/notes/n3', { type: 'topic_noted', data: { topic: 'spring', note: 'last' } });
}

function tablesFilledInPages(entry: LedgerEntry): void {
  it('equal the tables the appends kept, one keyed by its stream, one by its mapping, one of several rows under a key and one of the streams of orgs, filled a fact a page', async () => {
    const database = await entry.aDatabase();
    const inline = await openedInPages(entry, database, fourKinds);
    await aHistoryOfFourKinds(inline);
    const kept = await rowsOf(inline, theirNames);
    await inTurn(['run_tallies_2', 'topics_2', 'labels_1', 'remarks_1'], (table) =>
      entry.queried(database, `DROP TABLE ${table}`),
    );

    const filled = await openedInPages(entry, database, fourKinds);

    expect(kept.flat()).toHaveLength(7);
    expect(await rowsOf(filled, theirNames)).toEqual(kept);
  });

  it('carry a table on from its position beside a table made new, which meet and go on as one, both equal to the tables the appends kept', async () => {
    const database = await entry.aDatabase();
    const inline = await openedInPages(entry, database, [runTallyRows, topicRows]);
    await aHistoryOfFourKinds(inline);
    const kept = await rowsOf(inline, ['run_tallies', 'topics']);
    await entry.queried(database, 'DROP TABLE run_tallies_2');
    await entry.queried(database, 'DROP TABLE topics_2');
    await expect(openLedgerWith(inPages(entry, database, [failingOnAFailure(2)]))).rejects.toThrow(breakingDown);

    const carriedOn = await openedInPages(entry, database, [runTallyRows, topicRows]);

    expect(await rowsOf(carriedOn, ['run_tallies', 'topics'])).toEqual(kept);
    expect(
      await entry.queried(
        database,
        'SELECT folded_through FROM projection_checkpoints WHERE folded_through IS NOT NULL',
      ),
    ).toEqual([]);
  });
}

function windowsFoldingNothing(entry: LedgerEntry): void {
  it('advance their position through windows in which no table folds a fact', async () => {
    const database = await entry.aDatabase();
    const ledger = await openedInPages(entry, database, []);
    await topic(ledger, 'playbook/acme/alpha/notes/n1', {
      type: 'topic_noted',
      data: { topic: 'autumn', note: 'one' },
    });
    await topic(ledger, 'playbook/acme/alpha/notes/n1', {
      type: 'topic_noted',
      data: { topic: 'autumn', note: 'two' },
    });
    await topic(ledger, 'playbook/acme/alpha/runs/r1', { type: 'topic_opened', data: { topic: 'autumn', at: 1 } });
    await ran(ledger, 'r2', began);

    await expect(openLedgerWith(inPages(entry, database, [tallyRowsOf(2, () => true)]))).rejects.toThrow(breakingDown);

    expect(await entry.queried(database, checkpointsOfTheTallies)).toEqual([
      { projection: 'run_tallies', version: 2, folded_through: '3' },
    ]);
  });
}

function tablesOfTheTallies(entry: LedgerEntry, database: string) {
  return Promise.all([
    entry.queried(database, entry.projectionTables),
    entry.queried(database, checkpointsOfTheTallies),
  ]);
}

function earlierVersions(entry: LedgerEntry): void {
  it('keeps the table of the earlier version until the new one is caught up, then drops it with its row, and drops at the next opening an earlier table a drop cut off left', async () => {
    const database = await entry.aDatabase();
    await talliedHistory(await openedInPages(entry, database, [runTallyRows]));
    await expect(openLedgerWith(inPages(entry, database, [failingOnAFailure(3)]))).rejects.toThrow(breakingDown);
    const whileBehind = await tablesOfTheTallies(entry, database);
    await openedInPages(entry, database, [tallyRowsOf(3)]);
    const caughtUp = await tablesOfTheTallies(entry, database);
    await entry.queried(database, 'CREATE TABLE run_tallies_1 (playbook_key TEXT, row_key TEXT)');
    await entry.queried(database, "INSERT INTO projection_checkpoints VALUES ('run_tallies', 1, NULL)");

    await openedInPages(entry, database, [tallyRowsOf(3)]);

    expect(whileBehind).toEqual([
      [{ name: 'run_tallies_2' }, { name: 'run_tallies_3' }],
      [caughtUpAt(2), { projection: 'run_tallies', version: 3, folded_through: '4' }],
    ]);
    expect(caughtUp).toEqual([[{ name: 'run_tallies_3' }], [caughtUpAt(3)]]);
    expect(await tablesOfTheTallies(entry, database)).toEqual(caughtUp);
  });
}

export function catchUpBehaviour(entry: LedgerEntry): void {
  describe.skipIf(entry.itsOwnContractAlone === true)('the keyed tables caught up in pages as the ledger opens', () => {
    aFillCutOff(entry);
    tablesFilledInPages(entry);
    windowsFoldingNothing(entry);
    earlierVersions(entry);
  });
}
