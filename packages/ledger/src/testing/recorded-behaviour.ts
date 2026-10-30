import { InvalidCursor, type RecordedEvent, type RecordedOrder, type RecordedSelection } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { headsBehaviour } from '../heads/heads-behaviour.ts';
import { lineageBehaviour } from '../lineage/lineage-behaviour.ts';
import { runFiltersBehaviour } from '../run-filters/run-filters-behaviour.ts';
import {
  alpha,
  details,
  detailsOf,
  happen,
  happenings,
  inAlpha,
  noted,
  reading,
  type AnyLedger,
  type LedgerMaker,
} from './happenings.ts';
import { runsBehaviour } from './runs-behaviour.ts';

const everything: RecordedSelection = { kind: 'everything' };

const mebibyte = 1024 * 1024;

function thePlaybookOfARead(aLedger: LedgerMaker): void {
  describe('the playbook a read of what was recorded names', () => {
    it('is matched exactly, whatever its case, an underscore in it, or a playbook whose id it begins', async () => {
      const ledger = await aLedger();
      const streams = [
        'playbook/o/b/s',
        'playbook/o/B/s',
        'playbook/o/b2/s',
        'playbook/o/a_c/s',
        'playbook/o/abc/s',
        'playbook/o/b',
      ];
      await Promise.all(streams.map((stream) => happen(ledger, stream, noted('noted', stream))));

      const read = (playbook: string) =>
        reading(ledger, everything, { order: 'asc', limit: 10 }, { org: 'o', playbook });
      const pages = await Promise.all(['b', 'B', 'b2', 'a_c', 'abc', 'missing'].map((playbook) => read(playbook)));

      expect(pages.map((page) => details(page))).toEqual([
        ['playbook/o/b/s'],
        ['playbook/o/B/s'],
        ['playbook/o/b2/s'],
        ['playbook/o/a_c/s'],
        ['playbook/o/abc/s'],
        [],
      ]);
    });
  });
}

async function everyPage(
  ledger: AnyLedger,
  order: RecordedOrder,
  betweenPages: () => Promise<unknown>,
  cursor?: string,
): Promise<readonly RecordedEvent[]> {
  const page = await reading(ledger, everything, { order, limit: 2, ...(cursor === undefined ? {} : { cursor }) });
  await betweenPages();
  return page.nextCursor === null
    ? page.records
    : [...page.records, ...(await everyPage(ledger, order, betweenPages, page.nextCursor))];
}

function appendingUpTo(ledger: AnyLedger, last: number): () => Promise<unknown> {
  let appended = 5;
  return () => {
    appended += 1;
    return appended > last ? Promise.resolve() : happen(ledger, inAlpha(`notes-${appended}`), noted('noted', appended));
  };
}

function pagesWhileAppending(aLedger: LedgerMaker): void {
  describe('pages read while appends continue', () => {
    it('deliver every message exactly once, oldest first, those appended meanwhile included', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), ...[1, 2, 3, 4, 5].map((n) => noted('noted', n)));

      const read = await everyPage(ledger, 'asc', appendingUpTo(ledger, 8));
      await happen(ledger, inAlpha('notes-9'), noted('noted', 9));
      const after = await reading(ledger, everything, { order: 'asc', limit: 2, cursor: String(read.at(-1)?.cursor) });

      expect([detailsOf(read), details(after), after.nextCursor]).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9], null]);
    });

    it('deliver every message exactly once, newest first, and none appended after the first page', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), ...[1, 2, 3, 4, 5].map((n) => noted('noted', n)));

      const read = await everyPage(ledger, 'desc', appendingUpTo(ledger, 8));

      expect(detailsOf(read)).toEqual([5, 4, 3, 2, 1]);
    });
  });
}

function theBoundsOfAPage(aLedger: LedgerMaker): void {
  describe('the bounds of a page', () => {
    it('end a page at the limit of records asked for, with a cursor to the rest', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2), noted('noted', 3));

      const first = await reading(ledger, everything, { order: 'asc', limit: 2 });
      const rest = await reading(ledger, everything, { order: 'asc', limit: 2, cursor: String(first.nextCursor) });

      expect([details(first), first.hasMore, details(rest), rest.hasMore, rest.nextCursor]).toEqual([
        [1, 2],
        true,
        [3],
        false,
        null,
      ]);
    });

    it('end a page before it would load more than 4 MiB of data, one record of 1.5 MiB at a time', async () => {
      const ledger = await aLedger();
      const large = 'x'.repeat(1.5 * mebibyte);
      await Promise.all([1, 2, 3].map((n) => happen(ledger, inAlpha(`large-${n}`), noted('noted', [n, large]))));

      const first = await reading(ledger, everything, { order: 'asc', limit: 10 });
      const rest = await reading(ledger, everything, { order: 'asc', limit: 10, cursor: String(first.nextCursor) });

      expect([first.records.length, first.hasMore, rest.records.length, rest.nextCursor]).toEqual([2, true, 1, null]);
    });
  });
}

function aThousandNoted(ledger: AnyLedger): Promise<unknown> {
  return Effect.runPromise(
    Effect.forEach(
      Array.from({ length: 125 }, (_, stream) => stream),
      (stream) =>
        ledger.execute(
          inAlpha(`noted-${stream}`),
          happenings,
          Array.from({ length: 8 }, () => noted('noted')),
        ),
      { concurrency: 8, discard: true },
    ),
  );
}

function aFilterOfTypes(aLedger: LedgerMaker): void {
  describe('a filter of types', () => {
    it('examines up to 1,000 records for a page, and ends the page with a cursor past them', async () => {
      const ledger = await aLedger();
      await happen(
        ledger,
        inAlpha('notes'),
        ...Array.from({ length: 7 }, () => noted('noted')),
        noted('kept', 'early'),
      );
      await aThousandNoted(ledger);
      await happen(ledger, inAlpha('notes'), noted('kept', 'late'));

      const kept = { order: 'asc', limit: 2, types: ['kept'] } as const;
      const first = await reading(ledger, everything, kept);
      const empty = await reading(ledger, everything, { ...kept, cursor: String(first.records[0]?.cursor) });
      const rest = await reading(ledger, everything, { ...kept, cursor: String(empty.nextCursor) });

      expect([details(first), first.hasMore, details(empty), empty.hasMore, details(rest), rest.nextCursor]).toEqual([
        ['early'],
        true,
        [],
        true,
        ['late'],
        null,
      ]);
    });
  });
}

function theLastRecordExamined(aLedger: LedgerMaker): void {
  describe('the last record a page examined', () => {
    it('is named even at the end of the history, past records of types it does not want', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('kept', 1), noted('noted', 2), noted('noted', 3));
      const kept = { order: 'asc', limit: 10, types: ['kept'] } as const;

      const first = await reading(ledger, everything, kept);
      const whole = await reading(ledger, everything, { order: 'asc', limit: 10 });
      const atTheEnd = await reading(ledger, everything, { ...kept, cursor: String(first.lastExamined?.cursor) });
      await happen(ledger, inAlpha('notes'), noted('kept', 4));
      const later = await reading(ledger, everything, { ...kept, cursor: String(first.lastExamined?.cursor) });

      expect([details(first), first.nextCursor, first.lastExamined]).toEqual([
        [1],
        null,
        { cursor: whole.records[2]?.cursor, recordedAt: whole.records[2]?.recordedAt },
      ]);
      expect([details(atTheEnd), atTheEnd.lastExamined, details(later)]).toEqual([[], null, [4]]);
    });

    it('is the record a page that is cut short reads on after', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2), noted('noted', 3));
      await happen(ledger, inAlpha('runs/run-1'), noted('run_started'));

      const cut = await reading(ledger, everything, { order: 'asc', limit: 2 });
      const runs = await reading(ledger, { kind: 'runs' }, { order: 'asc', limit: 10 });

      expect([cut.lastExamined?.cursor, runs.lastExamined?.cursor]).toEqual([cut.nextCursor, runs.records[0]?.cursor]);
    });
  });
}

function cursorsOfARead(aLedger: LedgerMaker): void {
  describe('the cursor of a read', () => {
    it('is the cursor of each record, which reads on after it', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2), noted('noted', 3));
      const { records } = await reading(ledger, everything, { order: 'asc', limit: 10 });

      const after = await Promise.all(
        records.map(({ cursor }) => reading(ledger, everything, { order: 'asc', limit: 10, cursor })),
      );

      expect(after.map((page) => details(page))).toEqual([[2, 3], [3], []]);
    });

    it('is refused when it cannot be read, or another playbook gave it', async () => {
      const ledger = await aLedger();
      await happen(ledger, 'playbook/acme/beta/notes', noted('noted', 1));
      const beta = await reading(ledger, everything, { order: 'asc', limit: 1 }, { org: 'acme', playbook: 'beta' });
      const cursors = [...beta.records.map(({ cursor }) => cursor), 'not a cursor', 'WyJicmFpbi9hY21lL2FscGhhLyJd'];

      const refusals = await Promise.all(
        cursors.map((cursor) =>
          Effect.runPromise(Effect.flip(ledger.readRecorded(alpha, everything, { order: 'asc', limit: 1, cursor }))),
        ),
      );

      expect(refusals).toEqual([
        new InvalidCursor({ kind: 'of_another_playbook' }),
        new InvalidCursor({ kind: 'malformed' }),
        new InvalidCursor({ kind: 'malformed' }),
      ]);
    });
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function theTimeAPageStartsFrom(aLedger: LedgerMaker): void {
  describe('the time a page starts from', () => {
    it('bounds the page from below by the time the store recorded, oldest or newest first', async () => {
      const ledger = await aLedger();
      await happen(ledger, inAlpha('notes'), noted('noted', 1), noted('noted', 2));
      await sleep(1100);
      await happen(ledger, inAlpha('notes'), noted('noted', 3), noted('noted', 4));
      const { records } = await reading(ledger, everything, { order: 'asc', limit: 10 });
      const since = String(records[2]?.recordedAt);

      const pages = await Promise.all([
        reading(ledger, everything, { order: 'asc', limit: 10, since }),
        reading(ledger, everything, { order: 'desc', limit: 10, since }),
        reading(ledger, everything, { order: 'asc', limit: 10, since: '2000-01-01T00:00:00Z' }),
        reading(ledger, everything, { order: 'desc', limit: 10, since: '2999-01-01T00:00:00Z' }),
      ]);

      expect(pages.map((page) => [details(page), page.nextCursor])).toEqual([
        [[3, 4], null],
        [[4, 3], null],
        [[1, 2, 3, 4], null],
        [[], null],
      ]);
    });
  });
}

export function recordedBehaviour(aLedger: LedgerMaker): void {
  thePlaybookOfARead(aLedger);
  pagesWhileAppending(aLedger);
  theBoundsOfAPage(aLedger);
  aFilterOfTypes(aLedger);
  theLastRecordExamined(aLedger);
  cursorsOfARead(aLedger);
  theTimeAPageStartsFrom(aLedger);
  runsBehaviour(aLedger);
  runFiltersBehaviour(aLedger);
  lineageBehaviour(aLedger);
  headsBehaviour(aLedger);
}
