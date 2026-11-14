import { Conflict } from '@on.auto/operations';
import type { DefinitionNames } from '@on.auto/operations/definition-names';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { EncodedEvent, LedgerStore } from '../event-store.ts';
import { layoutFound } from '../layout/layout-found.ts';
import { ledgerLayoutSteps } from '../layout/ledger-steps.ts';
import { at } from '../multi-stream/multi-stream-cases.ts';
import type { DefinitionNamesEntry } from './definition-names-behaviour.ts';
import { definitionNamesFilledBy } from './names-filled.ts';

const Claimed = Schema.Struct({ definition: Schema.String, name: Schema.String, starts: Schema.Boolean });

const claimedIn = Schema.decodeUnknownSync(Claimed);

function refusedAs(): Conflict {
  return new Conflict({ detail: 'The name is taken', kind: 'taken' });
}

const changesNothing = (type: string) => type === 'noted';

const names: DefinitionNames = {
  types: ['claimed', 'forgotten', 'noted'],
  holdsNames: (stream) => stream.includes('/definitions/'),
  definitionKeyOf: ({ data }) => `definition/acme/${claimedIn(data).definition}/`,
  nameAfter: (_held, { type, data, stream }) =>
    changesNothing(type)
      ? undefined
      : type === 'forgotten'
        ? 'released'
        : {
            playbookKey: `${stream.split('/').slice(0, 3).join('/')}/`,
            definitionType: 'reasoning',
            name: claimedIn(data).name,
            status: 'active',
            hasTriggers: claimedIn(data).starts,
          },
  takenBy: refusedAs,
  bounds: [{ checkedBy: ['claimed'], counts: () => true, most: () => 0, beyond: refusedAs }],
};

function claimed(definition: string, name: string, starts = false): EncodedEvent {
  return { type: 'claimed', data: { definition, name, starts } };
}

function noted(definition: string): EncodedEvent {
  return { type: 'noted', data: { definition, name: 'noted', starts: false } };
}

const alpha = 'playbook/acme/alpha/definitions/reasoning';

const beta = 'playbook/acme/beta/definitions/reasoning';

const notes = 'playbook/acme/alpha/notes/n1';

function carryingTo23(mostBytes: number) {
  return {
    kept: 23,
    floor: 6,
    steps: [...ledgerLayoutSteps, { layout: 23, statements: [definitionNamesFilledBy(names, mostBytes)] }],
  };
}

async function appendedIn(
  store: LedgerStore,
  appends: readonly (readonly [string, readonly EncodedEvent[]])[],
): Promise<void> {
  const [first, ...rest] = appends;
  if (first === undefined) {
    return;
  }
  const [stream, events] = first;
  await store.append(stream, events, at((await store.read(stream)).version));
  await appendedIn(store, rest);
}

async function aStoreAt22Holding(
  entry: DefinitionNamesEntry,
  ...appends: readonly (readonly [string, readonly EncodedEvent[]])[]
) {
  const database = await entry.aDatabase();
  const store = entry.storeOn(database);
  onTestFinished(() => store.close());
  await store.migrate();
  await appendedIn(store, appends);
  await entry.queried(database, 'UPDATE ledger_layout SET layout = 22');
  return database;
}

const HeldRows = Schema.Array(
  Schema.Struct({
    playbook_key: Schema.String,
    name: Schema.String,
    definition_key: Schema.String,
    has_triggers: Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]),
  }),
);

async function heldIn(entry: DefinitionNamesEntry, database: string): Promise<readonly string[]> {
  const rows = Schema.decodeUnknownSync(HeldRows)(
    await entry.queried(database, 'SELECT * FROM definition_names_1 ORDER BY definition_key'),
  );
  return rows.map(
    (row) =>
      `${row.definition_key} ${row.playbook_key}${row.name}${row.has_triggers === true || row.has_triggers === 1 ? ' starting' : ''}`,
  );
}

async function stampedAt(entry: DefinitionNamesEntry, database: string, layout: number): Promise<void> {
  await entry.queried(
    database,
    'CREATE TABLE ledger_layout (one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row), layout INTEGER NOT NULL)',
  );
  await entry.queried(database, `INSERT INTO ledger_layout (layout) VALUES (${layout})`);
}

const history = [
  [alpha, [claimed('a', 'triage', true), claimed('b', 'brief')]],
  [beta, [claimed('c', 'triage')]],
  [beta, [noted('c')]],
  [notes, [claimed('z', 'triage')]],
  [alpha, [claimed('b', 'digest'), claimed('d', 'brief')]],
  [alpha, [{ type: 'forgotten', data: { definition: 'd', name: 'brief', starts: false } }]],
] as const;

async function filledAgain(entry: DefinitionNamesEntry, database: string, mostBytes: number) {
  await entry.queried(database, 'UPDATE ledger_layout SET layout = 22');
  await entry.queried(database, 'DELETE FROM definition_names_1');
  await entry.carriedOn(database, carryingTo23(mostBytes));
  return heldIn(entry, database);
}

function layoutAfter(entry: DefinitionNamesEntry, database: string): Promise<number | undefined> {
  return entry.executedOn(database, async (execute) => (await layoutFound(execute, entry.layout, [])).layout);
}

function refusalsOfTheFill(entry: DefinitionNamesEntry): void {
  it('leaves out a bound the keeper of the same declaration applies to an append', async () => {
    const database = await entry.aDatabase();
    const bounded = entry.storeKeepingNames(database, names);
    onTestFinished(() => bounded.close());
    await bounded.migrate();

    const refused = await bounded.append(alpha, [claimed('a', 'triage')], at(0)).catch((refusal: unknown) => refusal);

    expect(refused).toMatchObject({ detail: 'The name is taken' });
    expect(await heldIn(entry, database)).toEqual([]);
  });

  it('refuses to fill a name two definitions hold, and leaves the store at the layout before', async () => {
    const twice = await aStoreAt22Holding(entry, [alpha, [claimed('a', 'triage'), claimed('b', 'triage')]]);

    const refused = entry.carriedOn(twice, carryingTo23(1));

    await expect(refused).rejects.toThrow('1 name held by two definitions of one playbook and type');
    expect(await layoutAfter(entry, twice)).toBe(22);
  });

  it('refuses to fill when the facts of a definition give it no name, and leaves the store at the layout before', async () => {
    const unnamed = await aStoreAt22Holding(entry, [alpha, [claimed('a', 'triage'), noted('b')]]);

    const refused = entry.carriedOn(unnamed, carryingTo23(1));

    await expect(refused).rejects.toThrow('1 definition whose facts give it no name');
    expect(await layoutAfter(entry, unnamed)).toBe(22);
  });
}

export function namesStepBehaviour(entry: DefinitionNamesEntry): void {
  describe('layout step 23, which fills the names of definitions from the facts', () => {
    it('fills the table the keeper would have kept over the same facts, page by page, applying no bound', async () => {
      const database = await entry.aDatabase();
      const keeping = entry.storeKeepingNames(database, { ...names, bounds: [] });
      onTestFinished(() => keeping.close());
      await keeping.migrate();
      await appendedIn(keeping, history);
      const taken = await keeping.append(alpha, [claimed('e', 'triage')], at(5)).catch((refusal: unknown) => refusal);
      const kept = await heldIn(entry, database);
      const filled = [await filledAgain(entry, database, 4 * 1_048_576), await filledAgain(entry, database, 1)];

      expect([taken, kept]).toMatchObject([{ detail: 'The name is taken' }, { length: 3 }]);
      expect(filled).toEqual([kept, kept]);
    });

    it('opens a store whose first opening never made the tables of its facts', async () => {
      const unmade = await entry.aDatabase();
      await stampedAt(entry, unmade, 22);

      await entry.carriedOn(unmade, carryingTo23(1));

      expect(await heldIn(entry, unmade)).toEqual([]);
    });

    it('opens a store carried from before the table of names, in one opening', async () => {
      const before22 = await entry.aDatabase();
      await stampedAt(entry, before22, 21);

      await entry.carriedOn(before22, carryingTo23(1));

      expect(await heldIn(entry, before22)).toEqual([]);
    });

    refusalsOfTheFill(entry);
  });
}
