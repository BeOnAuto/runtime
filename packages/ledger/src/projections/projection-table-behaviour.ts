import { messageIdOf, type ProjectedRowsQuery } from '@on.auto/operations';
import {
  runFacts,
  runTallyRows,
  tallyRowsOf,
  topicFacts,
  topicRows,
  type RunFact,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runOutcomeTableBehaviour } from '../outcomes/run-outcome-table-behaviour.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { projectionsBehaviour, topicsOf } from './projections-behaviour.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };

const ended: RunFact = { type: 'run_ended', data: { status: 'failed', ms: 10, tokens: null } };

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 100 };

const breakingDown = 'The projection broke down';

function noting(ledger: Awaited<ReturnType<typeof aLedger>>, stream: string, ...facts: readonly RunFact[]) {
  return Effect.runPromise(ledger.execute(stream, runFacts, facts));
}

function anAppendThatBreaksDown(entry: LedgerEntry): void {
  describe('a projection that breaks down inside an append', () => {
    it('fails the append, which keeps nothing, the row it changed before included', async () => {
      const breaking = tallyRowsOf(2, (row) => row['status'] === 'failed');
      const ledger = await aLedger(entry, undefined, undefined, [breaking]);
      await noting(ledger, 'playbook/acme/alpha/runs/r1', began);

      await expect(
        noting(ledger, 'playbook/acme/alpha/runs/r1', { type: 'run_noted', data: {} }, ended),
      ).rejects.toThrow(breakingDown);

      expect(
        (await Effect.runPromise(ledger.readProjectedRows('run_tallies', alpha, everyRow))).map(({ row }) => row),
      ).toMatchObject([{ status: 'started', facts: 1 }]);
      expect((await Effect.runPromise(ledger.load('playbook/acme/alpha/runs/r1', runFacts))).version).toBe(1);
    });
  });
}

function aTableNotThereYet(entry: LedgerEntry): void {
  describe('the table of a projection that is not there yet', () => {
    it('is made with its indexes and filled when the ledger opens, from every run stream, and earlier versions dropped', async () => {
      const database = await entry.aDatabase();
      const first = await aLedger(entry, database, undefined, [runTallyRows]);
      await noting(first, 'playbook/acme/alpha/runs/r1', began, { type: 'run_noted', data: {} });
      await noting(first, 'playbook/acme/alpha/runs/r2', ended);
      await noting(first, 'playbook/acme/alpha/runs/r3/nested', began);

      const next = await aLedger(entry, database, undefined, [tallyRowsOf(3)]);

      expect(await Effect.runPromise(next.readProjectedRows('run_tallies', alpha, everyRow))).toMatchObject([
        { key: 'r1', row: { facts: 2, last_message: messageIdOf('playbook/acme/alpha/runs/r1', 2) } },
      ]);
      expect(await entry.queried(database, entry.projectionTables)).toEqual([{ name: 'run_tallies_3' }]);
      expect(await entry.queried(database, entry.projectionIndexes)).toEqual([
        { name: 'run_tallies_3_by_playbook_and_status' },
        { name: 'run_tallies_3_due' },
      ]);
    });

    it('is left as it is by a ledger that finds it', async () => {
      const database = await entry.aDatabase();
      await noting(await aLedger(entry, database, undefined, [runTallyRows]), 'playbook/acme/alpha/runs/r1', began);
      await entry.queried(database, "DELETE FROM run_tallies_2 WHERE row_key = 'r1'");

      const reopened = await aLedger(entry, database, undefined, [runTallyRows]);

      expect(await Effect.runPromise(reopened.readProjectedRows('run_tallies', alpha, everyRow))).toEqual([]);
    });

    it('reads no row it finds under a key that is no playbook’s', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database, undefined, [runTallyRows]);
      await noting(ledger, 'playbook/acme/alpha/runs/r1', began);
      await entry.queried(
        database,
        "INSERT INTO run_tallies_2 (playbook_key, row_key, due_at) VALUES ('org/acme/alpha/', 'r9', 0)",
      );
      const due = await Effect.runPromise(
        ledger.readDueRows('run_tallies', { column: 'due_at', through: Number.MAX_SAFE_INTEGER, limit: 10 }),
      );

      expect(due.map(({ org, playbook, key }) => `${org}/${playbook}/${key}`)).toEqual(['acme/alpha/r1']);
    });
  });
}

function topics(ledger: Awaited<ReturnType<typeof aLedger>>, stream: string, ...facts: readonly TopicFact[]) {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

const notesInAnAppend = 8;

const manyNotes = 40 * notesInAnAppend;

function notedMany(ledger: Awaited<ReturnType<typeof aLedger>>, stream: string) {
  const appends = Array.from({ length: manyNotes / notesInAnAppend }, (_, append) =>
    Array.from({ length: notesInAnAppend }, (__, index): TopicFact => ({
      type: 'topic_noted',
      data: {
        topic: 'autumn',
        note: `note ${append * notesInAnAppend + index}`,
      },
    })),
  );
  return Effect.runPromise(
    Effect.forEach(appends, (facts: readonly TopicFact[]) => ledger.execute(stream, topicFacts, facts), {
      discard: true,
    }),
  );
}

function aKeyedTableNotThereYet(entry: LedgerEntry): void {
  describe('the table of a projection keyed by its mapping that is not there yet', () => {
    it('is filled from the facts of every stream of its kinds in the order they were appended, and earlier versions dropped', async () => {
      const database = await entry.aDatabase();
      const first = await aLedger(entry, database);
      await topics(first, 'playbook/acme/alpha/notes/w1', {
        type: 'topic_noted',
        data: { topic: 'winter', note: 'never opened' },
      });
      await topics(first, 'playbook/acme/alpha/runs/r9', { type: 'topic_opened', data: { topic: 'spring', at: 1000 } });
      await topics(first, 'playbook/acme/alpha/notes/z9', {
        type: 'topic_noted',
        data: { topic: 'spring', note: 'first' },
      });
      await topics(first, 'playbook/acme/alpha/notes/a1', {
        type: 'topic_noted',
        data: { topic: 'spring', note: 'second' },
      });
      await topics(first, 'playbook/acme/alpha/others/o1', {
        type: 'topic_noted',
        data: { topic: 'spring', note: 'other' },
      });
      await topics(first, 'playbook/acme/alpha/runs/r8', { type: 'topic_opened', data: { topic: 'autumn', at: 2000 } });
      await notedMany(first, 'playbook/acme/alpha/notes/n1');
      await entry.queried(database, 'CREATE TABLE topics_1 (playbook_key text, row_key text)');

      const next = await aLedger(entry, database, undefined, [topicRows]);

      expect((await topicsOf(next)).map(({ key, row }) => [key, row['note'], row['open'], row['next_at']])).toEqual([
        ['autumn', `note ${manyNotes - 1}`, true, 7000],
        ['spring', 'second', true, 6000],
      ]);
      expect(await entry.queried(database, entry.topicTables)).toEqual([{ name: 'topics_2' }]);
    });
  });
}

export function projectionTableBehaviour(entry: LedgerEntry): void {
  runOutcomeTableBehaviour(entry);
  projectionsBehaviour((projections) => aLedger(entry, undefined, undefined, projections));
  anAppendThatBreaksDown(entry);
  aTableNotThereYet(entry);
  aKeyedTableNotThereYet(entry);
}
