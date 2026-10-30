import { messageIdOf } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RecordedPoint, RecordedStream } from '../event-store.ts';
import { eventAppenderOf, VersionConflict } from '../index.ts';
import { stamped } from './happenings.ts';
import { journal } from './journal.ts';
import { aLedger, aStore, tallies, type LedgerEntry } from './ledger-entry.ts';
import { openLedgerWith, outcomeOf } from './open-ledger.ts';
import { tally, tallyInterruptedBy } from './tally.ts';

export const run = 'run/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export function numbered(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ type: 'counted', data: { n: from + index } }));
}

export const three = [{ type: 'counted' as const, data: { by: 3 } }];

export async function eventsOf(reading: Promise<RecordedStream>) {
  const { version, messages } = await reading;
  return { version, events: messages.map(({ data }) => data) };
}

function readingAfterAVersion(entry: LedgerEntry): void {
  describe('reading a stream after a version', () => {
    it('gives the events after that version, and the version of the whole stream', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 3), { expectedVersion: 0, context: stamped });
      await store.append(run, numbered(4, 2), { expectedVersion: 3, context: stamped });

      expect(await eventsOf(store.read(run, 3))).toEqual({ version: 5, events: [{ n: 4 }, { n: 5 }] });
      expect(await eventsOf(store.read(run))).toEqual({ version: 5, events: [1, 2, 3, 4, 5].map((n) => ({ n })) });
    });

    it('gives no events and the version it was asked after when nothing follows it', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 3), { expectedVersion: 0, context: stamped });

      expect(await eventsOf(store.read(run, 3))).toEqual({ version: 3, events: [] });
      expect(await eventsOf(store.read('run/nobody-wrote', 0))).toEqual({ version: 0, events: [] });
    });
  });
}

function theLineageOfEachMessage(entry: LedgerEntry): void {
  describe('the lineage of each message', () => {
    it('names it by its stream and position, and keeps the cause and correlation it was appended with', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 2), { expectedVersion: 0, context: stamped });
      await eventAppenderOf(store, tally.eventSchema)(run, three, {
        expectedVersion: 2,
        context: stamped,
        lineage: { causationId: 'cause', correlationId: 'root' },
      }).pipe(Effect.runPromise);

      expect((await store.read(run)).messages.map(({ lineage }) => lineage)).toEqual([
        { id: messageIdOf(run, 1), causationId: null, correlationId: null },
        { id: messageIdOf(run, 2), causationId: null, correlationId: null },
        { id: messageIdOf(run, 3), causationId: 'cause', correlationId: 'root' },
      ]);
    });
  });
}

function orderOf(point: RecordedPoint): bigint {
  return point.reduce((order, part) => (order << 64n) + BigInt(part), 0n);
}

function readingWhatWasAppended(entry: LedgerEntry): void {
  describe('reading which streams were appended to after a point', () => {
    it('names each kind of stream of a playbook once, and each stream outside a playbook, appended to after the point', async () => {
      const store = await aStore(entry);
      await store.append('org/acme/playbooks', numbered(1, 1), { expectedVersion: 0, context: stamped });
      const before = await store.readAppended(undefined, 100);
      await store.append('playbook/acme/alpha/events/e1', numbered(1, 1), { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/alpha/events/e2', numbered(1, 2), { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/alpha/run-logs/r1', numbered(1, 1), { expectedVersion: 0, context: stamped });
      await store.append('org/acme/playbooks', numbered(2, 1), { expectedVersion: 1, context: stamped });

      const appended = await store.readAppended(before.through, 100);
      const nothingSince = await store.readAppended(appended.through, 100);

      expect(appended.streams.toSorted()).toEqual([
        'org/acme/playbooks',
        'playbook/acme/alpha/events/',
        'playbook/acme/alpha/run-logs/',
      ]);
      expect(appended.more).toBe(false);
      expect([nothingSince.streams, nothingSince.more]).toEqual([[], false]);
      expect(nothingSince.through).toHaveLength(appended.through.length);
      expect(orderOf(nothingSince.through) >= orderOf(appended.through)).toBe(true);
    });

    it('reads at most as many messages as it is asked, and the next read goes on after the last it read', async () => {
      const store = await aStore(entry);
      const before = await store.readAppended(undefined, 100);
      await store.append('playbook/acme/alpha/events/e1', numbered(1, 1), { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/beta/events/e1', numbered(1, 1), { expectedVersion: 0, context: stamped });
      await store.append('playbook/acme/gamma/events/e1', numbered(1, 1), { expectedVersion: 0, context: stamped });

      const first = await store.readAppended(before.through, 2);
      const next = await store.readAppended(first.through, 2);

      expect([first.streams.toSorted(), first.more]).toEqual([
        ['playbook/acme/alpha/events/', 'playbook/acme/beta/events/'],
        true,
      ]);
      expect([next.streams, next.more]).toEqual([['playbook/acme/gamma/events/'], false]);
    });
  });
}

function appendingWithAnExpectedVersion(entry: LedgerEntry): void {
  describe('appending with an expected version', () => {
    it.each([0, 1, 3])(
      'meets a version conflict and appends nothing when it expects %i of a stream at version 2',
      async (expected) => {
        const store = await aStore(entry);
        await store.append(run, numbered(1, 2), { expectedVersion: 0, context: stamped });

        expect(
          await outcomeOf(
            eventAppenderOf(store, tally.eventSchema)(run, three, { expectedVersion: expected, context: stamped }),
          ),
        ).toEqual(Result.fail(new VersionConflict()));
        expect(await eventsOf(store.read(run))).toEqual({ version: 2, events: [{ n: 1 }, { n: 2 }] });
      },
    );

    it('meets a version conflict when it expects a version of a stream nobody wrote', async () => {
      const store = await aStore(entry);

      expect(
        await outcomeOf(
          eventAppenderOf(store, tally.eventSchema)(run, three, { expectedVersion: 1, context: stamped }),
        ),
      ).toEqual(Result.fail(new VersionConflict()));
      expect(await eventsOf(store.read(run))).toEqual({ version: 0, events: [] });
    });

    it("rejects the append itself with the ledger's VersionConflict, the error any streams reject with when a stream moved", async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 2), { expectedVersion: 0, context: stamped });

      await expect(store.append(run, three, { expectedVersion: 1, context: stamped })).rejects.toBeInstanceOf(
        VersionConflict,
      );
      expect(await eventsOf(store.read(run))).toEqual({ version: 2, events: [{ n: 1 }, { n: 2 }] });
    });

    it('keeps the same event appended twice as two events', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 1), { expectedVersion: 0, context: stamped });
      await store.append(run, numbered(1, 1), { expectedVersion: 1, context: stamped });

      expect(await eventsOf(store.read(run))).toEqual({ version: 2, events: [{ n: 1 }, { n: 1 }] });
    });
  });
}

function closedAndOpenedAgain(entry: LedgerEntry): void {
  describe('a ledger closed and opened again', () => {
    it('keeps what was written and goes on from there', async () => {
      const database = await entry.aDatabase();
      const first = await openLedgerWith(entry.ledgerOn(database));
      await Effect.runPromise(first.ledger.execute(tallies, tally, [2, 3]));
      await Effect.runPromise(
        first.ledger.execute('playbook/acme/sales/journal', journal, [
          { type: 'entry_struck', data: { reason: 'Duplicate' } },
        ]),
      );
      await first.dispose();

      const second = await aLedger(entry, database);
      const reloaded = await Effect.runPromise(
        Effect.all([second.load(tallies, tally), second.load('playbook/acme/sales/journal', journal)]),
      );
      const continued = await Effect.runPromise(second.execute(tallies, tally, [4]));

      expect(reloaded).toEqual([
        { state: 5, version: 2 },
        { state: [{ type: 'entry_struck', data: { reason: 'Duplicate' }, context: stamped }], version: 1 },
      ]);
      expect(continued).toEqual({ state: 9, version: 3 });
    });
  });
}

function whoseDatabaseIsGone(entry: LedgerEntry): void {
  describe('a ledger whose database is gone', () => {
    it('answers every call after disposal with a defect', async () => {
      const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(await entry.aDatabase()));
      await dispose();

      await expect(outcomeOf(ledger.load(tallies, tally))).rejects.toThrow(entry.afterClosing);
      await expect(outcomeOf(ledger.execute(tallies, tally, [1]))).rejects.toThrow(entry.afterClosing);
    });

    it('turns a write that fails for a reason other than a version conflict into a defect', async () => {
      const { ledger, dispose } = await openLedgerWith(entry.ledgerOn(await entry.aDatabase()));
      const closeTheDatabaseFirst = Effect.promise(dispose);

      await expect(
        outcomeOf(ledger.execute(tallies, tallyInterruptedBy(closeTheDatabaseFirst, 1), [1])),
      ).rejects.toThrow(entry.closedWhileWriting);
    });
  });
}

export function storeBehaviour(entry: LedgerEntry): void {
  readingAfterAVersion(entry);
  theLineageOfEachMessage(entry);
  readingWhatWasAppended(entry);
  appendingWithAnExpectedVersion(entry);
  closedAndOpenedAgain(entry);
  whoseDatabaseIsGone(entry);
}
