import { labelNotes, labelReadModelOf, labelSets } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import {
  added,
  alpha,
  aStreamLedger,
  builtOf,
  historyOf,
  keptWith,
  labelled,
  readLogged,
  set,
  theHistoryFolded,
} from './stream-testing.ts';

const breaking = labelReadModelOf(1, [
  {
    ...labelSets,
    rowAfter: (row, message) => {
      if (JSON.stringify(message.data).includes('breaks')) {
        throw new Error('The fold broke down');
      }
      return labelSets.rowAfter(row, message);
    },
  },
  labelNotes,
]);

function resumedAfterAFailedPage(entry: LedgerEntry): void {
  describe('a catch-up whose page fails', () => {
    it('keeps every page before it, and the next read goes on from the checkpoint the last of them wrote', async () => {
      const database = await entry.aDatabase();
      const first = await aStreamLedger(entry, database);
      await labelled(first, 'playbook/acme/alpha/notes/n1', set('n1', 'a'), set('n1', 'b'), set('n1', 'breaks'));
      const broken = await aStreamLedger(entry, database, keptWith(breaking, 1));

      const failed = await Effect.runPromiseExit(broken.readProjectedRows('label_sets', alpha, everyRow));
      const checkpoint = await entry.queried(database, foldedThrough);
      const resumed = await readLogged(await aStreamLedger(entry, database, keptWith(labelReadModelOf(), 1)));

      expect([Exit.isFailure(failed), checkpoint]).toEqual([true, [{ folded_through: 2 }]]);
      expect(builtOf(resumed.logged)).toEqual([['playbook/acme/alpha/notes/n1', 2, 3, 1]]);
      expect(resumed.rows).toEqual([
        ['n1/1', 1, 1],
        ['n1/2', 1, 2],
        ['n1/3', 1, 3],
        ['n1', 'breaks', 1, 3],
      ]);
    });
  });
}

const everyRow = { where: [], orderBy: [], order: 'asc', limit: 100 } as const;

const foldedThrough = 'SELECT CAST(folded_through AS INTEGER) AS folded_through FROM labelled_checkpoints_1';

function caughtUpAfterARollback(entry: LedgerEntry): void {
  describe('the facts a release that keeps no stream projection appended, before the release that keeps it runs again', () => {
    it('are left by the next append, which finds its stream ahead of the checkpoint, and folded by the next read', async () => {
      const database = await entry.aDatabase();
      await labelled(await aStreamLedger(entry, database, keptWith()), 'playbook/acme/alpha/notes/n1', set('n1', 'a'));
      await labelled(
        await aStreamLedger(entry, database),
        'playbook/acme/alpha/notes/n1',
        set('n1', 'b'),
        added('n1', 'c'),
      );
      const returned = await aStreamLedger(entry, database, keptWith());
      await labelled(returned, 'playbook/acme/alpha/notes/n1', added('n1', 'd'));
      const left = await entry.queried(database, foldedThrough);

      const { rows, logged } = await readLogged(returned);

      expect([left, builtOf(logged)]).toEqual([[{ folded_through: 1 }], [['playbook/acme/alpha/notes/n1', 1, 4, 2]]]);
      expect(rows).toEqual([
        ['n1/1', 1, 1],
        ['n1/2', 1, 2],
        ['n1', 'b', 1, 2],
        ['n1', 'c', 2, 3],
        ['n1', 'd', 3, 4],
      ]);
    });
  });
}

function resetWhenAhead(entry: LedgerEntry): void {
  describe('a checkpoint ahead of its stream', () => {
    it('resets the rows of the playbook, which its read builds again from the facts', async () => {
      const database = await entry.aDatabase();
      const ledger = await aStreamLedger(entry, database, keptWith());
      await historyOf(ledger, 'alpha');
      await entry.queried(database, "UPDATE labelled_checkpoints_1 SET folded_through = 9 WHERE stream = 'notes/n2'");

      const { rows, logged } = await readLogged(ledger);

      expect(rows).toEqual(theHistoryFolded);
      expect(logged.map(({ annotations }) => [annotations['because'], annotations['stream']])).toEqual([
        ['checkpoint_ahead', undefined],
        [undefined, 'playbook/acme/alpha/notes/n1'],
        [undefined, 'playbook/acme/alpha/notes/n2'],
      ]);
    });
  });
}

function resetWhenAsked(entry: LedgerEntry): void {
  describe('a stream projection reset by its reader', () => {
    it('deletes the rows and checkpoints of the playbook alone, which its next read builds again', async () => {
      const database = await entry.aDatabase();
      const ledger = await aStreamLedger(entry, database, keptWith());
      await historyOf(ledger, 'alpha');
      await historyOf(ledger, 'beta');

      await Effect.runPromise(ledger.resetStreamProjection('labelled', alpha));
      await Effect.runPromise(ledger.resetStreamProjection('nothing', alpha));
      await Effect.runPromise(ledger.resetStreamProjection('labelled', { org: 'acme' }));
      const left = await entry.queried(
        database,
        "SELECT stream FROM labelled_checkpoints_1 WHERE playbook_key = 'playbook/acme/alpha/'",
      );
      const { rows, logged } = await readLogged(ledger);

      expect([left, rows, builtOf(logged).map(([stream]) => stream)]).toEqual([
        [],
        theHistoryFolded,
        ['playbook/acme/alpha/notes/n1', 'playbook/acme/alpha/notes/n2'],
      ]);
    });
  });
}

export function streamRecoveryBehaviour(entry: LedgerEntry): void {
  resumedAfterAFailedPage(entry);
  caughtUpAfterARollback(entry);
  resetWhenAhead(entry);
  resetWhenAsked(entry);
}
