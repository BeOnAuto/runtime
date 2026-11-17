import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { ActedContextSchema, earlierShapeOf, factOf, readingEarlierShapes } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqlOf, statement } from '../connection/statement.ts';
import type { StatementExecutor, TransactionalPool } from '../event-store.ts';
import { executedOn } from '../recorded/sqlite-checks.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { sqliteLayout } from './layout-dialects.ts';
import { layoutFound } from './layout-found.ts';
import { layoutCarryingBy, type LayoutStep, layoutStepsInSequence, sqlOn, stepsFrom } from './layout-steps.ts';
import { factsReadBy } from './ledger-facts-refused.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';
import { aSQLiteFileInLayout } from './sqlite-file-in-layout.ts';
import { sqliteLayoutCarried, sqliteLayoutKept } from './sqlite-schema.ts';

const CountedSchema = readingEarlierShapes(factOf('counted', Schema.Struct({ by: Schema.Int }), ActedContextSchema), [
  earlierShapeOf(factOf('tallied', Schema.Struct({ n: Schema.Int }), ActedContextSchema), ({ data, context }) => ({
    type: 'counted' as const,
    data: { by: data.n },
    context,
  })),
]);

const NotedSchema = factOf('noted', Schema.Struct({ text: Schema.String }), ActedContextSchema);

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'user-1' };

function aStepTo(layout: number): LayoutStep {
  return { layout, statements: [statement`INSERT INTO notes (layout) VALUES (${layout})`] };
}

function described(sql: SQL): string {
  return SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim();
}

interface Held {
  readonly tables: readonly string[];
  readonly layoutsRead?: readonly number[];
}

function aPoolHolding({ tables, layoutsRead = [] }: Held): {
  readonly pool: TransactionalPool;
  readonly asked: string[];
} {
  const asked: string[] = [];
  const layouts = [...layoutsRead];
  const answerTo = (said: string): readonly unknown[] =>
    said.includes('sqlite_master') ? tables.map((name) => ({ name })) : [{ layout: layouts.shift() }];
  const recordedAs = (where: string): StatementExecutor => ({
    query: (sql) => {
      asked.push(`${where}${described(sql)}`);
      return Promise.resolve({ rows: answerTo(described(sql)) });
    },
    command: (sql) => {
      asked.push(`${where}${described(sql)}`);
      return Promise.resolve();
    },
  });
  return {
    asked,
    pool: {
      execute: recordedAs('outside the transaction: '),
      withTransaction: async (handle) => {
        asked.push('BEGIN');
        const done = await handle({ execute: recordedAs('') });
        asked.push('COMMIT');
        return done;
      },
    },
  };
}

const tablesListed = "SELECT name FROM sqlite_master WHERE type = 'table'";

const layoutRead = 'SELECT layout FROM ledger_layout';

function noted(layout: number): LayoutStep {
  return { layout, statements: [statement`INSERT INTO notes (layout) VALUES (${layout})`] };
}

describe('the steps that carry a database forward', () => {
  it('lead from a layout to the one kept by one step for each number between, in order, whatever order they are given in', () => {
    const steps = [aStepTo(9), aStepTo(7), aStepTo(8)];

    expect(stepsFrom(6, { kept: 9, steps }).map(({ layout }) => layout)).toEqual([7, 8, 9]);
    expect(stepsFrom(8, { kept: 9, steps }).map(({ layout }) => layout)).toEqual([9]);
    expect(stepsFrom(9, { kept: 9, steps })).toEqual([]);
  });

  it('are taken together when several packages each give one to a layout, their statements in the order given', () => {
    const [first, second] = [aStepTo(7), aStepTo(7)];

    expect(stepsFrom(6, { kept: 7, steps: [first, second] })).toEqual([
      { layout: 7, statements: [...first.statements, ...second.statements] },
    ]);
  });

  it('are refused when none leads to a layout', () => {
    expect(() => stepsFrom(6, { kept: 7, steps: [] })).toThrow(
      'The ledger was given no step to layout 7 of its database, where it takes at least one',
    );
  });
});

describe('the steps of a layout, as their statements run and as they are put in sequence', () => {
  it('run a statement as it is written, or the one written for the dialect of the database', () => {
    const shared = statement`CREATE TABLE notes (note TEXT)`;
    const eachDialect = { sqlite: statement`SELECT ${'sqlite'}`, postgresql: statement`SELECT ${'postgresql'}` };

    expect([sqlOn('sqlite', shared), sqlOn('postgresql', shared)]).toEqual([sqlOf(shared), sqlOf(shared)]);
    expect([sqlOn('sqlite', eachDialect), sqlOn('postgresql', eachDialect)]).toEqual([
      sqlOf(eachDialect.sqlite),
      sqlOf(eachDialect.postgresql),
    ]);
  });

  it('are put in sequence from the earliest layout carried forward to the layout kept, leaving out a step to any other number', () => {
    const steps = Array.from({ length: ledgerLayout - ledgerLayoutFloor }, (_, at) =>
      aStepTo(ledgerLayoutFloor + at + 1),
    );
    const beyond = aStepTo(ledgerLayout + 1);

    expect(layoutCarryingBy()).toEqual({ kept: ledgerLayout, floor: ledgerLayoutFloor, steps: [] });
    expect(layoutStepsInSequence([beyond, ...steps.toReversed()])).toEqual(steps);
  });

  it('are carried forward from the floor a store is given in place of the floor of the ledger', () => {
    expect(layoutCarryingBy({ floor: ledgerLayoutFloor + 3 })).toEqual({
      kept: ledgerLayout,
      floor: ledgerLayoutFloor + 3,
      steps: [],
    });
  });

  it('are carried beside a reader of the facts the server reads, when it is given their schemas', () => {
    expect(layoutCarryingBy({ layoutSteps: [], factSchemas: [CountedSchema, NotedSchema] })).toMatchObject({
      kept: ledgerLayout,
      floor: ledgerLayoutFloor,
      steps: [],
      facts: { types: new Set(['counted', 'noted', 'tallied']) },
    });
  });
});

describe('the reader of the facts a server reads', () => {
  const { reads } = factsReadBy([CountedSchema, NotedSchema]);

  it('reads a fact through the schema of its type, an earlier shape through its reader', () => {
    expect([
      reads({ type: 'counted', data: { by: 2 }, context: acted }),
      reads({ type: 'tallied', data: { n: 2 }, context: acted }),
      reads({ type: 'noted', data: { text: 'kept' }, context: acted }),
    ]).toEqual([true, true, true]);
  });

  it('does not read a fact in a shape no reader of its type knows, nor one of a type it does not read', () => {
    expect([
      reads({ type: 'counted', data: { count: 2 }, context: acted }),
      reads({ type: 'noted', data: { text: 'kept' }, context: { at: 'now' } }),
      reads({ type: 'run_noted', data: {}, context: acted }),
    ]).toEqual([false, false, false]);
  });
});

describe('a SQLite file put in a layout of the ledger', () => {
  it('holds that layout in the table that keeps it, and no other table', async () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);

    await aSQLiteFileInLayout(fileName, ledgerLayout + 1);

    expect(await executedOn(fileName, (execute) => layoutFound(execute, sqliteLayout, []))).toEqual({
      layout: ledgerLayout + 1,
      tables: ['ledger_layout'],
    });
  });
});

describe('the layout of the ledger on SQLite, as the store migrates', () => {
  it('lists the tables of the schema and writes the layout into a table of one row of a database that holds none, all in one transaction', async () => {
    const { pool, asked } = aPoolHolding({ tables: [] });

    await sqliteLayoutKept(pool, []);

    expect(asked).toEqual([
      'BEGIN',
      tablesListed,
      'CREATE TABLE ledger_layout ( one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row), layout INTEGER NOT NULL )',
      `INSERT INTO ledger_layout (layout) VALUES (${ledgerLayout})`,
      'COMMIT',
    ]);
  });

  it('finds the layout of an earlier database in one transaction, then takes each step in a transaction of its own that reads the layout first and writes it last', async () => {
    const { pool, asked } = aPoolHolding({ tables: ['ledger_layout'], layoutsRead: [6, 6, 7] });

    await sqliteLayoutCarried(pool, [], { kept: 8, floor: 6, steps: [noted(8), noted(7)] });

    expect(asked).toEqual([
      'BEGIN',
      tablesListed,
      layoutRead,
      'COMMIT',
      'BEGIN',
      layoutRead,
      'INSERT INTO notes (layout) VALUES (7)',
      'UPDATE ledger_layout SET layout = 7',
      'COMMIT',
      'BEGIN',
      layoutRead,
      'INSERT INTO notes (layout) VALUES (8)',
      'UPDATE ledger_layout SET layout = 8',
      'COMMIT',
    ]);
  });

  it('leaves alone a step that another opening of the database took after the layout was found', async () => {
    const { pool, asked } = aPoolHolding({ tables: ['ledger_layout'], layoutsRead: [6, 7] });

    await sqliteLayoutCarried(pool, [], { kept: 7, floor: 6, steps: [noted(7)] });

    expect(asked.slice(4)).toEqual(['BEGIN', layoutRead, 'COMMIT']);
  });
});
