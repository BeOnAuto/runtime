import type { RecordedEvent, RecordedSelection } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { happen, inAlpha, noted, reading, type LedgerMaker } from '../testing/happenings.ts';

const everything: RecordedSelection = { kind: 'everything' };

const mebibyte = 1024 * 1024;

function headsOf(records: readonly RecordedEvent[]): readonly (readonly unknown[])[] {
  return records.map(({ stream, version, type, data }) => [stream, version, type, data !== undefined]);
}

function theVersionOfARecord(aLedger: LedgerMaker): void {
  describe('the version of a record within its stream', () => {
    it('is given with every record, of the whole playbook and of its runs', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2));
      await happen(ledger, inAlpha('runs/r1'), noted('run_started'));
      await happen(ledger, inAlpha('notes'), noted('noted', 3));
      await happen(ledger, inAlpha('runs/r1'), noted('run_succeeded'));

      const playbook = await reading(ledger, everything, { order: 'asc', limit: 10 });
      const runs = await reading(ledger, { kind: 'runs' }, { order: 'asc', limit: 10 });

      expect([
        playbook.records.map(({ stream, version }) => `${stream} ${version}`),
        runs.records.map(({ type, version }) => `${type} ${version}`),
      ]).toEqual([
        ['notes 1', 'notes 2', 'runs/r1 1', 'notes 3', 'runs/r1 2'].map((head) => `playbook/acme/alpha/${head}`),
        ['run_started 1', 'run_succeeded 2'],
      ]);
    });
  });
}

function aReadOfHeads(aLedger: LedgerMaker): void {
  describe('a read that loads the data of some types alone', () => {
    it('gives the other records with their id, stream, version, type and time, and no data', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('kept', 1), noted('passed', 2), noted('kept', 3));

      const { records } = await reading(ledger, everything, { order: 'asc', limit: 10, dataOf: ['kept'] });
      const none = await reading(ledger, everything, { order: 'asc', limit: 10, dataOf: [] });

      expect([headsOf(records), headsOf(none.records)]).toEqual([
        [
          [inAlpha('notes'), 1, 'kept', true],
          [inAlpha('notes'), 2, 'passed', false],
          [inAlpha('notes'), 3, 'kept', true],
        ],
        [
          [inAlpha('notes'), 1, 'kept', false],
          [inAlpha('notes'), 2, 'passed', false],
          [inAlpha('notes'), 3, 'kept', false],
        ],
      ]);
      expect(new Set(records.map(({ id }) => id)).size).toBe(3);
      expect(records.map(({ recordedAt }) => Number.isFinite(Date.parse(recordedAt)))).toEqual([true, true, true]);
    });
  });
}

function theBoundsOfAReadOfHeads(aLedger: LedgerMaker): void {
  describe('the bounds of a read that loads the data of some types alone', () => {
    it('counts toward the 4 MiB of a page only the data it loads', async () => {
      const ledger = await aLedger();
      const large = 'x'.repeat(1.5 * mebibyte);
      await Promise.all([1, 2, 3].map((n) => happen(ledger, inAlpha(`large-${n}`), noted('large', [n, large]))));

      const heads = await reading(ledger, everything, { order: 'asc', limit: 10, dataOf: ['small'] });
      const loaded = await reading(ledger, everything, { order: 'asc', limit: 10, dataOf: ['large'] });

      expect([heads.records.length, heads.nextCursor, loaded.records.length, loaded.hasMore]).toEqual([
        3,
        null,
        2,
        true,
      ]);
    });

    it('loads, of a run, the first and the latest message only when their types are asked for', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('runs/r1'), noted('run_started'), noted('run_failed'));

      const { records } = await reading(ledger, { kind: 'runs' }, { order: 'asc', limit: 10, dataOf: ['run_failed'] });

      expect(headsOf(records)).toEqual([
        [inAlpha('runs/r1'), 1, 'run_started', false],
        [inAlpha('runs/r1'), 2, 'run_failed', true],
      ]);
    });
  });
}

export function headsBehaviour(aLedger: LedgerMaker): void {
  theVersionOfARecord(aLedger);
  aReadOfHeads(aLedger);
  theBoundsOfAReadOfHeads(aLedger);
}
