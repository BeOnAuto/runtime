import { labelReadModelOf } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { streamRebuildBehaviour } from './stream-rebuild-behaviour.ts';
import { streamRecoveryBehaviour } from './stream-recovery-behaviour.ts';
import { aStreamLedger, beta, builtOf, historyOf, keptWith, readLogged, theHistoryFolded } from './stream-testing.ts';

function foldedInline(entry: LedgerEntry): void {
  describe('a stream projection whose streams are appended to after the ledger opens with it', () => {
    it('folds each append into its tables inside the append, so a read finds every stream at its checkpoint and builds nothing', async () => {
      const database = await entry.aDatabase();
      const ledger = await aStreamLedger(entry, database, keptWith());
      await historyOf(ledger, 'alpha');

      const { rows, logged } = await readLogged(ledger);

      expect(rows).toEqual(theHistoryFolded);
      expect(logged).toEqual([]);
      expect(
        await entry.queried(
          database,
          'SELECT stream, CAST(folded_through AS INTEGER) AS folded_through FROM labelled_checkpoints_1 ORDER BY stream',
        ),
      ).toEqual([
        { stream: 'notes/n1', folded_through: 4 },
        { stream: 'notes/n2', folded_through: 1 },
      ]);
    });
  });
}

function caughtUpOnRead(entry: LedgerEntry): void {
  describe('a stream projection over facts appended before the ledger kept it', () => {
    it('is built on its first read by catch-up, stream by stream, into the rows the appends would have kept', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database), 'alpha');
      const ledger = await aStreamLedger(entry, database, keptWith());
      await historyOf(ledger, 'beta');

      const first = await readLogged(ledger);
      const again = await readLogged(ledger);

      expect([first.rows, again.rows]).toEqual([(await readLogged(ledger, beta)).rows, theHistoryFolded]);
      expect([builtOf(first.logged), again.logged]).toEqual([
        [
          ['playbook/acme/alpha/notes/n1', 0, 4, 3],
          ['playbook/acme/alpha/notes/n2', 0, 1, 1],
        ],
        [],
      ]);
    });

    it('is built the same a fact a page, when the store bounds a read of its facts below the size of one', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database), 'alpha');
      const ledger = await aStreamLedger(entry, database, keptWith(labelReadModelOf(), 1));

      const { rows, logged } = await readLogged(ledger);

      expect(rows).toEqual(theHistoryFolded);
      expect(builtOf(logged)).toEqual([
        ['playbook/acme/alpha/notes/n1', 0, 4, 4],
        ['playbook/acme/alpha/notes/n2', 0, 1, 1],
      ]);
    });
  });
}

function readOfAnOrg(entry: LedgerEntry): void {
  describe('a read of a table of a stream projection under an org, which folds a playbook’s streams alone', () => {
    it('builds nothing and answers no rows', async () => {
      const database = await entry.aDatabase();
      await historyOf(await aStreamLedger(entry, database), 'alpha');
      const ledger = await aStreamLedger(entry, database, keptWith());

      expect(await readLogged(ledger, { org: 'acme' })).toEqual({ rows: [], logged: [] });
    });
  });
}

export function streamProjectionBehaviour(entry: LedgerEntry): void {
  foldedInline(entry);
  caughtUpOnRead(entry);
  readOfAnOrg(entry);
  streamRecoveryBehaviour(entry);
  streamRebuildBehaviour(entry);
}
