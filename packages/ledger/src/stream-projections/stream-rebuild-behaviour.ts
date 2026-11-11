import type { Ledger } from '@on.auto/operations';
import { LabelFactSchema, labelNotes, labelReadModelOf, labelSets } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import {
  aStreamLedger,
  builtOf,
  historyOf,
  keptWith,
  labelled,
  readLogged,
  refusalLogged,
  set,
  theHistoryFolded,
} from './stream-testing.ts';

function scrubbed(ledger: Ledger['Service'], note: string) {
  return ledger.scrubFact(`playbook/acme/alpha/notes/${note}`, 1, {
    eventSchema: LabelFactSchema,
    data: { note, labels: ['urgent'] },
    erasure: { type: 'label_added', data: { note, label: 'erased' } },
    context: { at: '2026-11-11T10:00:00.000Z', by: 'eraser' },
  });
}

function rebuiltAfterAScrub(entry: LedgerEntry): void {
  describe('a fact of a stream of a stream projection scrubbed in place', () => {
    it('resets the rows of its playbook in the scrub’s transaction, which the next read builds from the scrubbed facts', async () => {
      const database = await entry.aDatabase();
      const ledger = await aStreamLedger(entry, database, keptWith());
      await labelled(ledger, 'playbook/acme/alpha/notes/n1', set('n1', 'urgent', 'call 0123'));
      await labelled(ledger, 'playbook/acme/alpha/notes/n3', set('n3', 'of no stream it folds'));

      await Effect.runPromise(Effect.forEach(['n1', 'n3'], (note) => scrubbed(ledger, note), { discard: true }));
      const { rows, logged } = await readLogged(ledger);

      expect(builtOf(logged)).toEqual([['playbook/acme/alpha/notes/n1', 0, 2, 2]]);
      expect(rows).toEqual([
        ['n1/1', 1, 1],
        ['n1', 'erased', 2, 2],
        ['n1', 'urgent', 1, 1],
      ]);
    });
  });
}

function rebuiltOnANewVersion(entry: LedgerEntry): void {
  describe('a stream projection of a new version', () => {
    it('makes its tables empty as the ledger opens, drops those of earlier versions, and builds them on the next read', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database, keptWith()), 'alpha');

      const next = await aStreamLedger(entry, database, keptWith(labelReadModelOf(2)));
      const { rows, logged } = await readLogged(next);

      expect(rows).toEqual(theHistoryFolded);
      expect(builtOf(logged).map(([stream, from]) => [stream, from])).toEqual([
        ['playbook/acme/alpha/notes/n1', 0],
        ['playbook/acme/alpha/notes/n2', 0],
      ]);
      expect(await entry.queried(database, entry.labelledTables)).toEqual([
        { name: 'label_notes_2' },
        { name: 'label_sets_2' },
        { name: 'labelled_checkpoints_2' },
        { name: 'labelled_rows_2' },
      ]);
    });
  });
}

const countedWrong = labelReadModelOf(1, [{ ...labelSets, keyOf: () => 'one' }, labelNotes]);

const firstSetAlone = labelReadModelOf(1, [
  labelSets,
  { ...labelNotes, rowAfter: (row, message) => row ?? labelNotes.rowAfter(row, message) },
]);

function failedWhenItsCountsDiffer(entry: LedgerEntry): void {
  describe('a stream projection whose rows, once built, disagree with the count of the facts they stand for', () => {
    it('is reset and built again once, and then fails the read, saying so', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database), 'alpha');
      const ledger = await aStreamLedger(entry, database, keptWith(countedWrong));

      await expect(readLogged(ledger)).rejects.toThrow(
        'The rows of the read model labelled of playbook/acme/alpha disagree with its facts after it was built again',
      );
    });
  });
}

function failedWhenNotTheGreatest(entry: LedgerEntry): void {
  describe('a stream projection whose row, once built, is not the greatest row of its group in another table', () => {
    it('is reset and built again once, and then fails the read, saying so', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database), 'alpha');
      const ledger = await aStreamLedger(entry, database, keptWith(firstSetAlone));

      await expect(readLogged(ledger)).rejects.toThrow(
        'The rows of the read model labelled of playbook/acme/alpha disagree with its facts after it was built again',
      );
    });
  });
}

function refusedOnceItDisagreed(entry: LedgerEntry): void {
  describe('a stream projection whose rows disagreed with its facts after it was built again', () => {
    it('keeps none of those rows, and refuses each later read of its playbook without building, its breaker open', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database), 'alpha');
      const ledger = await aStreamLedger(entry, database, keptWith(countedWrong));

      const [first, later] = [await refusalLogged(ledger), await refusalLogged(ledger)];
      const rebuilt = await readLogged(await aStreamLedger(entry, database, keptWith()));

      expect([first.refused, builtOf(first.logged).length > 0, later.refused, later.logged]).toEqual([
        true,
        true,
        true,
        [],
      ]);
      expect([rebuilt.rows, new Set(builtOf(rebuilt.logged).map(([, from]) => from))]).toEqual([
        theHistoryFolded,
        new Set([0]),
      ]);
    });
  });
}

export function streamRebuildBehaviour(entry: LedgerEntry): void {
  refusedOnceItDisagreed(entry);
  rebuiltAfterAScrub(entry);
  rebuiltOnANewVersion(entry);
  failedWhenItsCountsDiffer(entry);
  failedWhenNotTheGreatest(entry);
}
