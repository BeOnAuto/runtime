import { cursorWithin, messageIdOf, type Lineage, type RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  alpha,
  details,
  happenings,
  inAlpha,
  noted,
  reading,
  stamped,
  type AnyLedger,
  type LedgerMaker,
} from '../testing/happenings.ts';

function happenWith(ledger: AnyLedger, stream: string, lineage: Lineage, detail: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, happenings, [noted('noted', detail)], lineage));
}

function lineagesOf(records: readonly RecordedEvent[]): readonly (Lineage & { readonly id: string })[] {
  return records.map(({ id, causationId, correlationId }) => ({ id, causationId, correlationId }));
}

const root = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const child = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

function idsOfARead(aLedger: LedgerMaker): void {
  describe('the lineage of what a playbook recorded', () => {
    it('names each message by its stream and position, with the cause and correlation it was written with', async () => {
      const ledger = await aLedger();
      await happenWith(ledger, inAlpha(`runs/${root}`), { causationId: null, correlationId: root }, 'start');
      const start = messageIdOf(inAlpha(`runs/${root}`), 1);
      await happenWith(ledger, inAlpha(`run-logs/${root}`), { causationId: start, correlationId: root }, 'input');
      await Effect.runPromise(
        ledger.execute(inAlpha('definitions/reasoning'), happenings, [noted('noted', 'definition')]),
      );

      const { records } = await reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10 });

      expect(lineagesOf(records)).toEqual([
        { id: start, causationId: null, correlationId: root },
        { id: messageIdOf(inAlpha(`run-logs/${root}`), 1), causationId: start, correlationId: root },
        { id: messageIdOf(inAlpha('definitions/reasoning'), 1), causationId: null, correlationId: null },
      ]);
    });
  });
}

function aReadByCorrelation(aLedger: LedgerMaker): void {
  describe('a read by correlation', () => {
    it('answers what a run and the runs it caused recorded, in the order of the playbook, and nothing for a child', async () => {
      const ledger = await aLedger();
      const ofRoot = { causationId: null, correlationId: root };
      await happenWith(ledger, inAlpha(`runs/${root}`), ofRoot, 'root started');
      await happenWith(ledger, inAlpha('notes'), { causationId: null, correlationId: null }, 'elsewhere');
      await happenWith(ledger, inAlpha(`runs/${child}`), ofRoot, 'child started');
      await happenWith(ledger, 'playbook/acme/beta/notes', ofRoot, 'another playbook');
      await happenWith(ledger, inAlpha(`runs/${root}`), ofRoot, 'root finished');

      const pages = await Promise.all([
        reading(ledger, { kind: 'correlated', correlation: root }, { order: 'asc', limit: 2 }),
        reading(ledger, { kind: 'correlated', correlation: root }, { order: 'desc', limit: 10 }),
        reading(ledger, { kind: 'correlated', correlation: child }, { order: 'asc', limit: 10 }),
      ]);
      const rest = await reading(
        ledger,
        { kind: 'correlated', correlation: root },
        { order: 'asc', limit: 2, cursor: String(pages[0].nextCursor) },
      );

      expect([...pages, rest].map((page) => details(page))).toEqual([
        ['root started', 'child started'],
        ['root finished', 'child started', 'root started'],
        [],
        ['root finished'],
      ]);
    });
  });
}

function aReadFromInsideARecord(aLedger: LedgerMaker): void {
  describe('a read from a cursor inside a record', () => {
    it('begins with that record, in either order', async () => {
      const ledger = await aLedger();
      await Effect.runPromise(
        ledger.execute(inAlpha('notes'), happenings, [noted('noted', 1), noted('noted', 2), noted('noted', 3)]),
      );
      const { records } = await reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10 });
      const cursor = cursorWithin(String(records[1]?.cursor), 4);

      const pages = await Promise.all([
        reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10, cursor }),
        reading(ledger, { kind: 'everything' }, { order: 'desc', limit: 10, cursor }),
      ]);

      expect(pages.map((page) => details(page))).toEqual([
        [2, 3],
        [2, 1],
      ]);
    });
  });
}

function oneEventByItsId(aLedger: LedgerMaker): void {
  describe('the read of one event by its id', () => {
    it('answers the event of the playbook with its data, context and place, and nothing of another playbook or none', async () => {
      const ledger = await aLedger();
      await happenWith(ledger, inAlpha(`runs/${root}`), { causationId: null, correlationId: root }, 'start');
      await happenWith(ledger, inAlpha(`runs/${root}`), { causationId: null, correlationId: root }, 'finish');
      await happenWith(ledger, 'playbook/acme/beta/notes', { causationId: null, correlationId: null }, 'elsewhere');
      const finished = messageIdOf(inAlpha(`runs/${root}`), 2);

      const read = await Promise.all(
        [finished, messageIdOf('playbook/acme/beta/notes', 1), 'no such event'].map((id) =>
          Effect.runPromise(ledger.readRecordedEvent(alpha, id)),
        ),
      );

      expect(read[0]).toMatchObject({
        id: finished,
        stream: inAlpha(`runs/${root}`),
        version: 2,
        type: 'noted',
        data: { detail: 'finish' },
        context: stamped,
        correlationId: root,
      });
      expect(read.slice(1)).toEqual([undefined, undefined]);
    });

    it('gives each record its context and a place across the ledger that grows with each message', async () => {
      const ledger = await aLedger();
      await happenWith(ledger, inAlpha('notes'), { causationId: null, correlationId: null }, 'first');
      await happenWith(ledger, 'playbook/acme/beta/notes', { causationId: null, correlationId: null }, 'elsewhere');
      await happenWith(ledger, inAlpha('notes'), { causationId: null, correlationId: null }, 'second');

      const { records } = await reading(ledger, { kind: 'everything' }, { order: 'asc', limit: 10 });
      const [first, second] = records.map(({ globalPosition }) => globalPosition);

      expect(records.map(({ context }) => context)).toEqual([stamped, stamped]);
      expect(Number(second) - Number(first)).toBeGreaterThan(1);
    });
  });
}

export function lineageBehaviour(aLedger: LedgerMaker): void {
  idsOfARead(aLedger);
  oneEventByItsId(aLedger);
  aReadByCorrelation(aLedger);
  aReadFromInsideARecord(aLedger);
}
