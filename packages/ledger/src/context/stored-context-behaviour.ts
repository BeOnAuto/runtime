import { type Context } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventAppenderOf } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { aLedger, aStore, type LedgerEntry } from '../testing/ledger-entry.ts';
import { notes } from '../testing/notes.ts';
import { outcomeOf } from '../testing/open-ledger.ts';
import { eventsOf, numbered, run, three } from '../testing/store-behaviour.ts';
import { tally } from '../testing/tally.ts';

const ofACall: Context = {
  at: '2026-10-09T12:43:51.435Z',
  by: 'playbook:finance',
  runId: 'r-1',
  definitionType: 'interaction',
  definitionName: 'approve-report',
  definitionVersion: 1,
  calledBy: { runId: 'r-0', reference: '/do/0/ask', run: 1 },
  callDepth: 1,
  depth: 2,
  trigger: { kind: 'event', reference: '/schedule/on' },
};

function theContextOfEachMessage(entry: LedgerEntry): void {
  describe('the context of each message', () => {
    it('is kept whole beside the store’s own fields and read back with each message', async () => {
      const store = await aStore(entry);
      await store.append(run, numbered(1, 2), { expectedVersion: 0, context: ofACall });
      await store.append(run, numbered(3, 1), { expectedVersion: 2, context: stamped });

      expect((await store.read(run)).messages.map(({ context }) => context)).toEqual([ofACall, ofACall, stamped]);
      expect((await store.read(run, 2)).messages.map(({ context }) => context)).toEqual([stamped]);
    });

    it('is refused before anything is appended when it holds U+0000 or an unpaired surrogate', async () => {
      const store = await aStore(entry);
      const appended = eventAppenderOf(store, tally.eventSchema);

      await expect(
        outcomeOf(appended(run, three, { expectedVersion: 0, context: { ...ofACall, by: 'playbook:\u0000finance' } })),
      ).rejects.toThrow('text without control characters');
      await expect(
        outcomeOf(
          appended(run, three, { expectedVersion: 0, context: { ...ofACall, definitionName: 'approve\uD800' } }),
        ),
      ).rejects.toThrow('text without control characters');
      expect(await eventsOf(store.read(run))).toEqual({ version: 0, events: [] });
    });
  });
}

const PlaceRows = Schema.Array(
  Schema.Struct({ stream: Schema.String, position: Schema.Number, global_position: Schema.Number }),
);

function thePlaceOfEachRecord(entry: LedgerEntry): void {
  describe('the place of each record a playbook read', () => {
    it('names the stream, the position and the global position the table holds for its message', async () => {
      const database = await entry.aDatabase();
      const ledger = await aLedger(entry, database);
      await Effect.runPromise(ledger.execute('playbook/acme/alpha/notes', notes, [{ a: 1 }, { b: 2 }]));
      await Effect.runPromise(ledger.execute('playbook/acme/beta/notes', notes, [{ c: 3 }]));
      await Effect.runPromise(ledger.execute('playbook/acme/alpha/runs/r1', notes, [{ d: 4 }]));

      const { records } = await Effect.runPromise(
        ledger.readRecorded({ org: 'acme', playbook: 'alpha' }, { kind: 'everything' }, { order: 'asc', limit: 10 }),
      );
      const columns = Schema.decodeUnknownSync(PlaceRows)(
        await entry.queried(
          database,
          "SELECT stream_id AS stream, CAST(stream_position AS INTEGER) AS position, CAST(global_position AS INTEGER) AS global_position FROM emt_messages WHERE stream_id LIKE 'playbook/acme/alpha/%' ORDER BY global_position",
        ),
      );

      expect(
        records.map(({ stream, version, globalPosition }) => ({
          stream,
          position: version,
          global_position: globalPosition,
        })),
      ).toEqual(columns);
    });
  });
}

function thePlansOfTheReads(entry: LedgerEntry): void {
  describe('the plans of the reads a definition filter and an event id make', () => {
    it('walk the index of first messages by kind for the runs of one definition, and the index on the message id for one event', async () => {
      const database = await entry.aDatabase();
      await aLedger(entry, database);
      const playbookKey = 'playbook/acme/alpha/';

      const ofOneDefinition = await entry.planOf(database, (store) =>
        store.readRecorded(
          playbookKey,
          { kind: 'runs', definitionType: 'workflow', name: 'summary' },
          {
            order: 'desc',
            limit: 5,
          },
        ),
      );
      const ofOneEvent = await entry.planOf(database, (store) => store.readRecordedEvent(playbookKey, 'message-1'));

      expect(ofOneDefinition).toContain(entry.throughTheKindIndex);
      expect(ofOneEvent).toContain(entry.throughTheIdIndex);
    });
  });
}

export function storedContextBehaviour(entry: LedgerEntry): void {
  theContextOfEachMessage(entry);
  thePlaceOfEachRecord(entry);
  thePlansOfTheReads(entry);
}
