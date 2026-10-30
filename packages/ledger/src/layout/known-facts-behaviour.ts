import { ActedContextSchema, factOf } from '@on.auto/operations';
import { runFacts } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { statement } from '../connection/statement.ts';
import { aLedger, tallies, type LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutFound } from './layout-found.ts';
import type { LayoutCarrying } from './layout-steps.ts';
import { factsReadBy, LedgerFactsRefused, type FactSchemaRead } from './ledger-facts-refused.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';

const BeganSchema = factOf('run_began', Schema.Struct({ at: Schema.String, fn: Schema.String }), ActedContextSchema);

const EndedSchema = factOf(
  'run_ended',
  Schema.Struct({ status: Schema.String, ms: Schema.NullOr(Schema.Int), tokens: Schema.NullOr(Schema.Int) }),
  ActedContextSchema,
);

const EndedInAnotherShapeSchema = factOf('run_ended', Schema.Struct({ outcome: Schema.String }), ActedContextSchema);

const NotedInAnotherShapeSchema = factOf('run_noted', Schema.Struct({ text: Schema.String }), ActedContextSchema);

const madeByAnotherRelease =
  'so it was made by an earlier or a later release of the server than this one reads. A database a later release made wants that release or a later one, and one an earlier release made is not carried forward, so delete the local database and start the server again';

async function aDatabaseHoldingFacts(entry: LedgerEntry): Promise<string> {
  const database = await entry.aDatabase();
  const ledger = await aLedger(entry, database);
  await Effect.runPromise(
    ledger.execute(tallies, runFacts, [
      { type: 'run_began', data: { at: '2026-10-05T09:00:00.000Z', fn: 'triage' } },
      { type: 'run_noted', data: {} },
      { type: 'run_ended', data: { status: 'succeeded', ms: 4, tokens: null } },
    ]),
  );
  await Effect.runPromise(ledger.execute(tallies, runFacts, [{ type: 'run_noted', data: {} }]));
  return database;
}

function reading(schemas: readonly FactSchemaRead[], kept = ledgerLayout): LayoutCarrying {
  const carriedTables = {
    layout: 7,
    statements: [statement`CREATE TABLE carried_notes (note TEXT NOT NULL)`],
  };
  return { kept, floor: ledgerLayoutFloor, steps: [carriedTables], facts: factsReadBy(schemas) };
}

function refusalOf(entry: LedgerEntry, database: string, carrying: LayoutCarrying): Promise<unknown> {
  return entry.carriedOn(database, carrying).catch((error: unknown) => error);
}

function openedBehaviour(entry: LedgerEntry): void {
  it('opens a database whose newest fact of each type the server reads, and reads none when it is given no schemas', async () => {
    const database = await aDatabaseHoldingFacts(entry);

    await entry.carriedOn(database, reading([runFacts.eventSchema]));
    await entry.carriedOn(database, { kept: ledgerLayout, floor: ledgerLayoutFloor, steps: [] });

    expect((await entry.executedOn(database, (execute) => layoutFound(execute, entry.layout, []))).layout).toBe(
      ledgerLayout,
    );
  });
}

function refusedBehaviour(entry: LedgerEntry): void {
  it('refuses a database that holds facts of types the server does not read, or whose newest fact of a type is in a shape it does not read, naming each', async () => {
    const database = await aDatabaseHoldingFacts(entry);

    const refusals = [
      await refusalOf(entry, database, reading([BeganSchema, EndedSchema])),
      await refusalOf(entry, database, reading([BeganSchema])),
      await refusalOf(entry, database, reading([BeganSchema, EndedSchema, NotedInAnotherShapeSchema])),
      await refusalOf(entry, database, reading([EndedInAnotherShapeSchema, NotedInAnotherShapeSchema])),
    ];

    expect(refusals[0]).toBeInstanceOf(LedgerFactsRefused);
    expect(refusals).toMatchObject([
      {
        unknown: ['run_noted'],
        message: `The ledger's database holds facts of the type run_noted, which this server does not read, ${madeByAnotherRelease}`,
      },
      {
        unknown: ['run_ended', 'run_noted'],
        message: `The ledger's database holds facts of the types run_ended, run_noted, which this server does not read, ${madeByAnotherRelease}`,
      },
      {
        unknown: [],
        unreadable: [{ type: 'run_noted', position: '4' }],
        message: `The ledger's database holds the fact run_noted at position 4, in a shape this server does not read, ${madeByAnotherRelease}`,
      },
      {
        unknown: ['run_began'],
        message: `The ledger's database holds facts of the type run_began, which this server does not read, and the facts run_ended at position 3, run_noted at position 4, in a shape this server does not read, ${madeByAnotherRelease}`,
      },
    ]);
  });

  it('refuses a database it would carry forward before it takes any step', async () => {
    const database = await aDatabaseHoldingFacts(entry);

    const refused = await refusalOf(entry, database, reading([BeganSchema], 7));

    expect(refused).toMatchObject({ unknown: ['run_ended', 'run_noted'] });
    expect((await entry.executedOn(database, (execute) => layoutFound(execute, entry.layout, []))).layout).toBe(
      ledgerLayout,
    );
    await expect(entry.queried(database, 'SELECT note FROM carried_notes')).rejects.toThrow('carried_notes');
  });
}

export function knownFactsBehaviour(entry: LedgerEntry): void {
  describe('the facts a database holds, read as the ledger opens it', () => {
    openedBehaviour(entry);
    refusedBehaviour(entry);
  });
}
