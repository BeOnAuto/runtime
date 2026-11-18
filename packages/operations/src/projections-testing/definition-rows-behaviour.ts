import { Cause, Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionNames } from '../definition-names/name-judgement.ts';
import type { Ledger } from '../ledger/ledger.ts';
import { Conflict } from '../outcome/conflict.ts';
import {
  everyDefinitionOf,
  type KeyedProjection,
  type ProjectedAddress,
  type ProjectedRowsQuery,
} from '../projections/keyed-projection.ts';
import { remarkFacts } from '../projections/remark-rows.ts';
import { runTallyRows } from '../projections/tally-rows.ts';
import { topicFacts, topicRows, type TopicFact } from '../projections/topic-rows.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';

type AnyLedger = Ledger['Service'];

export type NamingLedger = (projections: readonly KeyedProjection[], names: DefinitionNames) => Promise<AnyLedger>;

const Remark = Schema.Struct({ text: Schema.String });

export const definitionsPlaced: DefinitionNames = {
  types: ['remark_made'],
  holdsNames: (stream) => stream.startsWith('definition/'),
  definitionKeyOf: ({ stream }) => `${stream.split('/').slice(0, 3).join('/')}/`,
  nameAfter: (_held, { data }) => ({
    playbookKey: `playbook/acme/${Schema.decodeUnknownSync(Remark)(data).text}/`,
    definitionType: 'workflow',
    name: 'placed',
    status: 'active',
    hasTriggers: false,
  }),
  takenBy: (claimed) => new Conflict({ detail: `${claimed.name} is held`, kind: 'taken' }),
};

const everyRow: ProjectedRowsQuery = { where: [], orderBy: [], order: 'asc', limit: 10 };

const alpha = { org: 'acme', playbook: 'alpha' };

export async function placedIn(ledger: AnyLedger, definition: string, playbook: string): Promise<unknown> {
  const exit = await Effect.runPromiseExit(
    ledger.execute(`definition/acme/${definition}/remarks/placed`, remarkFacts, [
      { type: 'remark_made', data: { text: playbook } },
    ]),
  );
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
}

function began(fn: string): RunFact {
  return { type: 'run_began', data: { at: '2026-11-16T09:00:00.000Z', fn } };
}

export function ran(ledger: AnyLedger, stream: string): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, runFacts, [began(stream)]));
}

export function addressesOfRows(ledger: AnyLedger, projection: string, address: ProjectedAddress) {
  return Effect.runPromise(
    Effect.map(ledger.readProjectedRows(projection, address, everyRow), (rows) =>
      rows.map(({ org, playbook, definition, key }) => ({ org, playbook, definition, key })),
    ),
  );
}

function rowsOfDefinitions(open: NamingLedger): void {
  it('keeps each row under its definition, and reads and counts for a playbook its own rows and those of the definitions that hold a name in it', async () => {
    const ledger = await open([{ ...runTallyRows, scopes: ['playbook', 'definition'] }], definitionsPlaced);
    await placedIn(ledger, 'd1', 'alpha');
    await placedIn(ledger, 'd2', 'beta');
    await ran(ledger, 'playbook/acme/alpha/runs/r0');
    await ran(ledger, 'definition/acme/d1/runs/r1');
    await ran(ledger, 'definition/acme/d2/runs/r2');
    await ran(ledger, 'definition/acme/d3/runs/r3');
    const refused = await placedIn(ledger, 'd4', 'alpha');
    await ran(ledger, 'definition/acme/d4/runs/r4');

    const answers = await Promise.all([
      addressesOfRows(ledger, 'run_tallies', alpha),
      addressesOfRows(ledger, 'run_tallies', { org: 'acme', definition: 'd3' }),
      addressesOfRows(ledger, 'run_tallies', { org: 'acme' }),
      Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, [])),
    ]);

    expect(answers).toEqual([
      [
        { org: 'acme', playbook: 'alpha', definition: undefined, key: 'r0' },
        { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'r1' },
      ],
      [{ org: 'acme', playbook: undefined, definition: 'd3', key: 'r3' }],
      [],
      2,
    ]);
    expect(refused).toEqual(new Conflict({ detail: 'placed is held', kind: 'taken' }));
  });
}

function dueRowsOfDefinitions(open: NamingLedger): void {
  it('answers each due row with the playbook its definition is in now, and none for a definition that holds no name', async () => {
    const ledger = await open([{ ...runTallyRows, scopes: ['playbook', 'definition'] }], definitionsPlaced);
    await placedIn(ledger, 'd1', 'alpha');
    await ran(ledger, 'playbook/acme/beta/runs/r0');
    await ran(ledger, 'definition/acme/d1/runs/r1');
    await ran(ledger, 'definition/acme/d3/runs/r3');

    const due = await Effect.runPromise(
      ledger.readDueRows('run_tallies', { column: 'due_at', through: Number.MAX_SAFE_INTEGER, limit: 10 }),
    );

    expect(due.map(({ org, playbook, definition, key }) => ({ org, playbook, definition, key }))).toEqual([
      { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'r1' },
      { org: 'acme', playbook: undefined, definition: 'd3', key: 'r3' },
      { org: 'acme', playbook: 'beta', definition: undefined, key: 'r0' },
    ]);
  });
}

function rowsOfPlaybooksAlone(open: NamingLedger): void {
  it('folds no stream of a definition into a projection of the streams of playbooks alone, and advances a row under its definition', async () => {
    const ledger = await open([runTallyRows, { ...topicRows, scopes: ['definition'] }], definitionsPlaced);
    await placedIn(ledger, 'd1', 'alpha');
    await ran(ledger, 'definition/acme/d1/runs/r1');
    await Effect.runPromise(
      ledger.execute('definition/acme/d1/runs/r2', topicFacts, [
        { type: 'topic_opened', data: { topic: 'spring', at: 0 } },
      ]),
    );

    await Effect.runPromise(
      ledger.advanceRow('topics', { org: 'acme', definition: 'd1' }, 'spring', { set: { open: false }, when: [] }),
    );
    const topics = await Effect.runPromise(ledger.readProjectedRows('topics', alpha, everyRow));

    expect(await Effect.runPromise(ledger.countProjectedRows('run_tallies', alpha, []))).toBe(0);
    expect(topics.map(({ definition, key, row }) => [definition, key, row['open']])).toEqual([['d1', 'spring', false]]);
  });
}

function topic(ledger: AnyLedger, stream: string, fact: TopicFact): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, [fact]));
}

export const topicsAtTheOrg: KeyedProjection = { ...topicRows, scopes: ['definition'], partition: 'org' };

function rowsAtTheOrg(open: NamingLedger): void {
  it("folds the streams of every definition of an org into one row at the org, the last fact in the store's order winning, and another org's into a row of its own", async () => {
    const ledger = await open([topicsAtTheOrg], definitionsPlaced);
    await placedIn(ledger, 'd1', 'alpha');
    await placedIn(ledger, 'd2', 'beta');
    await topic(ledger, 'definition/acme/d1/runs/r1', { type: 'topic_opened', data: { topic: 'spring', at: 0 } });
    await topic(ledger, 'definition/acme/d2/notes/n1', {
      type: 'topic_noted',
      data: { topic: 'spring', note: 'beta' },
    });
    await topic(ledger, 'definition/acme/d1/notes/n2', {
      type: 'topic_noted',
      data: { topic: 'spring', note: 'alpha' },
    });
    await topic(ledger, 'definition/umbrella/d9/runs/r9', { type: 'topic_opened', data: { topic: 'spring', at: 0 } });

    const [acme, umbrella, ofAPlaybook] = await Promise.all([
      Effect.runPromise(ledger.readProjectedRows('topics', { org: 'acme' }, everyRow)),
      Effect.runPromise(ledger.readProjectedRows('topics', { org: 'umbrella' }, everyRow)),
      addressesOfRows(ledger, 'topics', alpha),
    ]);

    expect(
      acme.map(({ org, playbook, definition, key, row }) => [org, playbook, definition, key, row['note']]),
    ).toEqual([['acme', undefined, undefined, 'spring', 'alpha']]);
    expect(umbrella.map(({ org, key, row }) => [org, key, row['note']])).toEqual([['umbrella', 'spring', null]]);
    expect(ofAPlaybook).toEqual([]);
  });
}

function rowsOfEveryDefinition(open: NamingLedger): void {
  it('reads the rows of every definition the playbooks of an org hold, each with its playbook, in the order and page asked, and of no other', async () => {
    const ledger = await open([{ ...runTallyRows, scopes: ['playbook', 'definition'] }], definitionsPlaced);
    await placedIn(ledger, 'd1', 'alpha');
    await placedIn(ledger, 'd2', 'beta');
    await placedIn(ledger, 'd4', 'gamma');
    await ran(ledger, 'definition/acme/d4/runs/r0');
    await ran(ledger, 'definition/acme/d2/runs/r2');
    await ran(ledger, 'definition/acme/d1/runs/r1');
    await ran(ledger, 'definition/acme/d3/runs/r3');
    await ran(ledger, 'playbook/acme/alpha/runs/r5');
    await ran(ledger, 'definition/umbrella/d1/runs/r6');
    const ofAcme = everyDefinitionOf({ org: 'acme' });

    const answers = await Promise.all([
      addressesOfRows(ledger, 'run_tallies', ofAcme),
      Effect.runPromise(ledger.readProjectedRows('run_tallies', ofAcme, { ...everyRow, order: 'desc', limit: 2 })),
      Effect.runPromise(ledger.countProjectedRows('run_tallies', ofAcme, [])),
    ]);

    expect(answers[0]).toEqual([
      { org: 'acme', playbook: 'gamma', definition: 'd4', key: 'r0' },
      { org: 'acme', playbook: 'alpha', definition: 'd1', key: 'r1' },
      { org: 'acme', playbook: 'beta', definition: 'd2', key: 'r2' },
    ]);
    expect(answers[1].map(({ key }) => key)).toEqual(['r2', 'r1']);
    expect(answers[2]).toBe(3);
  });
}

export function definitionRowsBehaviour(open: NamingLedger): void {
  describe('a projection of the streams filed under the key of a definition', () => {
    rowsOfDefinitions(open);
    dueRowsOfDefinitions(open);
    rowsOfPlaybooksAlone(open);
    rowsAtTheOrg(open);
    rowsOfEveryDefinition(open);
  });
}
