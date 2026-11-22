import type { RecordedSelection } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { details, happen, inAlpha, noted, reading, type AnyLedger, type LedgerMaker } from './happenings.ts';

const everything: RecordedSelection = { kind: 'everything' };

function aSecondAfter(recordedAt: string): string {
  return new Date(Date.parse(recordedAt) + 1000).toISOString();
}

export function theTimeAPageStartsFrom(aLedger: LedgerMaker): void {
  describe('the time a page starts from', () => {
    it('bounds the page from below by the time the store recorded, oldest or newest first, that time itself included', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2));
      await happen(ledger, inAlpha('notes'), noted('noted', 3), noted('noted', 4));
      const { records } = await reading(ledger, everything, { order: 'asc', limit: 10 });
      const first = String(records[0]?.recordedAt);
      const afterTheLast = aSecondAfter(String(records.at(-1)?.recordedAt));

      const pages = await Promise.all([
        reading(ledger, everything, { order: 'asc', limit: 10, since: first }),
        reading(ledger, everything, { order: 'desc', limit: 10, since: first }),
        reading(ledger, everything, { order: 'asc', limit: 10, since: afterTheLast }),
        reading(ledger, everything, { order: 'desc', limit: 10, since: afterTheLast }),
        reading(ledger, everything, { order: 'asc', limit: 10, since: '2000-01-01T00:00:00Z' }),
        reading(ledger, everything, { order: 'desc', limit: 10, since: '2999-01-01T00:00:00Z' }),
      ]);

      expect(pages.map((page) => [details(page), page.nextCursor])).toEqual([
        [[1, 2, 3, 4], null],
        [[4, 3, 2, 1], null],
        [[], null],
        [[], null],
        [[1, 2, 3, 4], null],
        [[], null],
      ]);
    });
  });
}

export interface ALedgerWhoseRecordsMoveBack {
  readonly ledger: AnyLedger;
  readonly recordedASecondEarlier: () => Promise<void>;
}

export function aPageSplitAtTheTimeItStartsFrom(
  aLedgerWhoseRecordsMoveBack: () => Promise<ALedgerWhoseRecordsMoveBack>,
): void {
  describe('the time a page starts from, between records the store kept a second apart', () => {
    it('leaves out what the store recorded before it and keeps what it recorded from it on, oldest or newest first', async () => {
      const { ledger, recordedASecondEarlier } = await aLedgerWhoseRecordsMoveBack();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2));
      await recordedASecondEarlier();
      await happen(ledger, inAlpha('notes'), noted('noted', 3), noted('noted', 4));
      const { records } = await reading(ledger, everything, { order: 'asc', limit: 10 });
      const since = String(records[2]?.recordedAt);

      const pages = await Promise.all([
        reading(ledger, everything, { order: 'asc', limit: 10, since }),
        reading(ledger, everything, { order: 'desc', limit: 10, since }),
      ]);

      expect(pages.map((page) => [details(page), page.nextCursor])).toEqual([
        [[3, 4], null],
        [[4, 3], null],
      ]);
    });
  });
}
