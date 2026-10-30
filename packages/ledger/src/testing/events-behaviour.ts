import { ActedContextSchema, ActedOnRunContextSchema, Conflict, factOf, type Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stamped } from './happenings.ts';
import { journal, type JournalEvent } from './journal.ts';
import { aLedger, tallies, type LedgerEntry } from './ledger-entry.ts';
import { notes } from './notes.ts';
import { outcomeOf } from './open-ledger.ts';
import { tally, type Amounts } from './tally.ts';

const decided: readonly JournalEvent[] = [
  {
    type: 'entry_written',
    data: {
      at: new Date('2026-09-30T23:59:59.999Z'),
      amount: 12_345_678_901_234_567_890n,
      ratio: Number.NaN,
      tags: [],
      source: null,
    },
  },
  {
    type: 'entry_written',
    data: {
      at: new Date(0),
      amount: -1n,
      ratio: Number.NEGATIVE_INFINITY,
      tags: ['quarter-end', 'café', '"quoted"', 'line\nbreak', 'a NUL \u0000 inside', 'half a pair \uD800 alone'],
      memo: 'Tab\there, emoji 🧾, and a backslash \\',
      source: { name: 'Ledger of record' },
    },
  },
  { type: 'entry_struck', data: { reason: 'Written twice' } },
];

const talliedAboveFive = {
  ...tally,
  eventSchema: factOf('counted', Schema.Struct({ by: Schema.Int.check(Schema.isGreaterThan(5)) }), ActedContextSchema),
};

const talliedOnARun = {
  ...tally,
  eventSchema: factOf('counted', Schema.Struct({ by: Schema.Int }), ActedOnRunContextSchema),
};

function theEventsOfAStream(entry: LedgerEntry): void {
  describe('the events of a stream', () => {
    it('come back exactly as they were decided, through the JSON encoding of their schema', async () => {
      const ledger = await aLedger(entry);

      await Effect.runPromise(ledger.execute('playbook/acme/sales/journal', journal, decided));

      expect(await Effect.runPromise(ledger.load('playbook/acme/sales/journal', journal))).toEqual({
        state: decided.map(({ type, data }) => ({ type, data, context: stamped })),
        version: 3,
      });
    });

    it('keep the keys of every object in the order they were written', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(
        ledger.execute('playbook/acme/sales/notes', notes, [
          { zeta: 1, a: [2, { y: true, x: null }], longer_key: '3' },
        ]),
      );

      const { state } = await Effect.runPromise(ledger.load('playbook/acme/sales/notes', notes));

      expect(JSON.stringify(state)).toBe('[{"zeta":1,"a":[2,{"y":true,"x":null}],"longer_key":"3"}]');
    });

    it('are a defect, not a rejection, when a stored event no longer decodes', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(tallies, tally, [3]));

      await expect(outcomeOf(ledger.load(tallies, talliedAboveFive))).rejects.toThrow(
        'Expected a value greater than 5\n  at ["data"]["by"]',
      );
      await expect(outcomeOf(ledger.execute(tallies, talliedAboveFive, [6]))).rejects.toThrow(
        'Expected a value greater than 5\n  at ["data"]["by"]',
      );
    });

    it('are a defect when a stored event’s context is not the one its fact carries', async () => {
      const ledger = await aLedger(entry);
      await Effect.runPromise(ledger.execute(tallies, tally, [3]));

      await expect(outcomeOf(ledger.load(tallies, talliedOnARun))).rejects.toThrow(
        'Missing key\n  at ["context"]["runId"]',
      );
    });
  });
}

const names = [
  'org/acme/playbooks',
  'org/Acme/playbooks',
  'org/ACME/playbooks',
  'org/acme-corp/playbooks',
  'org/acme_corp/playbooks',
  'org/acme/playbooks/',
  'org/acme//playbooks',
  ' org/acme/playbooks',
  'org/acme-x',
  'org/acme-y',
  'playbook/acme/sales/definitions/reasoning',
  'playbook/acme/sales-definitions/reasoning',
  'playbook/acme/sales_definitions/reasoning',
  'org/café/playbooks'.normalize('NFC'),
  'org/café/playbooks'.normalize('NFD'),
];

function streamNames(entry: LedgerEntry): void {
  describe('stream names', () => {
    it('are kept exactly as given, so names that differ only in case, punctuation or Unicode form are different streams', async () => {
      const ledger = await aLedger(entry);

      const written = await Effect.runPromise(
        Effect.forEach(names, (name, index) => ledger.execute(name, tally, [index + 1])),
      );
      const loaded = await Effect.runPromise(Effect.forEach(names, (name) => ledger.load(name, tally)));

      const expected = Array.from(names.keys(), (index) => ({ state: index + 1, version: 1 }));
      expect(written).toEqual(Array.from(names.keys(), (index) => ({ state: index + 1, version: 1, decidedOn: 0 })));
      expect(loaded).toEqual(expected);
    });
  });
}

const commands: readonly Amounts[] = [[1, 2], [], [-10], [4], [-7], []];

function tallyThrough(ledger: Ledger['Service']): Promise<unknown> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executed = yield* Effect.forEach(commands, (amounts) =>
        Effect.result(ledger.execute('org/acme/tallies', tally, amounts)),
      );
      const loaded = yield* ledger.load('org/acme/tallies', tally);
      return { executed, loaded };
    }),
  );
}

const entries: readonly (readonly JournalEvent[])[] = [
  [{ type: 'entry_written', data: { at: new Date(86_400_000), amount: 7n, ratio: 0.5, tags: ['a'], source: null } }],
  [],
  [
    { type: 'entry_struck', data: { reason: 'Wrong amount' } },
    {
      type: 'entry_written',
      data: {
        at: new Date(0),
        amount: -7n,
        ratio: Number.POSITIVE_INFINITY,
        tags: [],
        memo: 'Corrected',
        source: { name: 'Review' },
      },
    },
  ],
];

function journalThrough(ledger: Ledger['Service']): Promise<unknown> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executed = yield* Effect.forEach(entries, (events) =>
        ledger.execute('playbook/acme/sales/journal', journal, events),
      );
      const loaded = yield* ledger.load('playbook/acme/sales/journal', journal);
      return { executed, loaded };
    }),
  );
}

async function loadAskedForBeforeAWrite(ledger: Ledger['Service']): Promise<unknown> {
  const loading = ledger.load('org/acme/tallies', tally);
  await Effect.runPromise(ledger.execute('org/acme/tallies', tally, [2]));
  return Effect.runPromise(loading);
}

const talliedThroughBoth = {
  executed: [
    Result.succeed({ state: 3, version: 2, decidedOn: 0 }),
    Result.succeed({ state: 3, version: 2, decidedOn: 3 }),
    Result.fail(new Conflict({ detail: 'A tally of 3 cannot fall to -7' })),
    Result.succeed({ state: 7, version: 3, decidedOn: 3 }),
    Result.succeed({ state: 0, version: 4, decidedOn: 7 }),
    Result.succeed({ state: 0, version: 4, decidedOn: 0 }),
  ],
  loaded: { state: 0, version: 4 },
};

function agreementWithTheInMemoryLedger(entry: LedgerEntry): void {
  describe('the ledger and the in-memory ledger of the application layer', () => {
    it('give the same states, versions and rejections for the same decider and commands', async () => {
      expect(await tallyThrough(await aLedger(entry))).toEqual(talliedThroughBoth);
      expect(await tallyThrough(memoryLedger().service)).toEqual(talliedThroughBoth);
    });

    it('give back the same events for a schema whose JSON encoding differs from its type', async () => {
      const throughTheStore = await journalThrough(await aLedger(entry));

      expect(throughTheStore).toEqual(await journalThrough(memoryLedger().service));
      expect(throughTheStore).toMatchObject({ loaded: { state: entries.flat(), version: 3 } });
    });

    it('read a stream when the load runs, not when it is asked for', async () => {
      expect(await loadAskedForBeforeAWrite(await aLedger(entry))).toEqual({ state: 2, version: 1 });
      expect(await loadAskedForBeforeAWrite(memoryLedger().service)).toEqual({ state: 2, version: 1 });
    });
  });
}

export function eventsBehaviour(entry: LedgerEntry): void {
  theEventsOfAStream(entry);
  streamNames(entry);
  agreementWithTheInMemoryLedger(entry);
}
