import { describe, expect, it } from 'vitest';

import { statement } from '../connection/statement.ts';
import type { ContentConnections } from '../content/postgresql-content.ts';
import { postgresqlLayout } from '../layout/layout-dialects.ts';
import type { LayoutStep } from '../layout/layout-steps.ts';
import { ledgerLayout } from '../layout/ledger-layout.ts';
import { postgresqlLayoutCarried, postgresqlLayoutKept } from './postgresql-layout.ts';
import { emmettsMigrationLock } from './postgresql-run-outcomes.ts';

interface Held {
  readonly tables: readonly string[];
  readonly layoutsRead?: readonly number[];
  readonly refusing?: string;
}

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function rowsOf(text: string, tables: readonly string[], layout: () => number | undefined): readonly unknown[] {
  if (text.includes('pg_try_advisory_xact_lock')) {
    return [{ locked: true }];
  }
  if (text.includes('pg_tables')) {
    return tables.map((name) => ({ name }));
  }
  return text.startsWith('SELECT layout') ? [{ layout: layout() }] : [];
}

function aDatabaseHolding({ tables, layoutsRead = [], refusing = 'nothing' }: Held): {
  readonly connections: ContentConnections;
  readonly asked: readonly Asked[];
} {
  const asked: Asked[] = [];
  const layouts = [...layoutsRead];
  const answerTo = (text: string) => rowsOf(text, tables, () => layouts.shift());
  const query = (written: string, values: readonly unknown[]) => {
    const text = written.replaceAll(/\s+/gu, ' ').trim();
    asked.push({ text, values });
    return text.startsWith(refusing)
      ? Promise.reject(new Error(`The database refused ${text}`))
      : Promise.resolve({ rows: answerTo(text) });
  };
  const release = () => {
    asked.push({ text: 'released', values: [] });
  };
  return { asked, connections: { query, connect: () => Promise.resolve({ query, release }) } };
}

function told(text: string, values: readonly unknown[] = []): Asked {
  return { text, values };
}

const lockTaken = told('SELECT pg_try_advisory_xact_lock($1) AS locked', [emmettsMigrationLock]);

const tablesListed = told('SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()');

const layoutRead = told('SELECT layout FROM ledger_layout');

const marked: LayoutStep = {
  layout: 7,
  statements: [
    statement`CREATE TABLE marks (dialect TEXT)`,
    {
      sqlite: statement`INSERT INTO marks (dialect) VALUES (${'sqlite'})`,
      postgresql: statement`INSERT INTO marks (dialect) VALUES (${'postgresql'})`,
    },
  ],
};

describe('the layout of a new or kept ledger on PostgreSQL, kept in a transaction of its own before the migration', () => {
  it('takes the migration lock, lists the tables of the schema, and writes the layout into a table of one row of a database that holds none', async () => {
    const { connections, asked } = aDatabaseHolding({ tables: [] });

    await postgresqlLayoutKept(connections, []);

    expect(asked).toEqual([
      told('BEGIN'),
      lockTaken,
      tablesListed,
      told(
        'CREATE TABLE ledger_layout ( one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row), layout INTEGER NOT NULL )',
      ),
      told('INSERT INTO ledger_layout (layout) VALUES ($1)', [ledgerLayout]),
      told('COMMIT'),
      told('released'),
    ]);
  });

  it('reads the layout of a database that holds its table, and writes nothing when it is the layout kept', async () => {
    const { connections, asked } = aDatabaseHolding({ tables: ['ledger_layout'], layoutsRead: [ledgerLayout] });

    await postgresqlLayoutKept(connections, [], { layoutSteps: [] });

    expect(asked).toEqual([told('BEGIN'), lockTaken, tablesListed, layoutRead, told('COMMIT'), told('released')]);
  });
});

describe('the layout of an earlier ledger on PostgreSQL, carried forward', () => {
  it('takes each step in a transaction of its own under the migration lock, with the statement written for PostgreSQL, and writes the layout last', async () => {
    const { connections, asked } = aDatabaseHolding({ tables: ['ledger_layout'], layoutsRead: [6, 6] });

    await postgresqlLayoutCarried(connections, [], { kept: 7, floor: 6, steps: [marked] });

    expect(asked.slice(6)).toEqual([
      told('BEGIN'),
      lockTaken,
      layoutRead,
      told('CREATE TABLE marks (dialect TEXT)'),
      told('INSERT INTO marks (dialect) VALUES ($1)', ['postgresql']),
      told('UPDATE ledger_layout SET layout = $1', [7]),
      told('COMMIT'),
      told('released'),
    ]);
  });

  it('rolls back the transaction of a step whose statement the database refuses, and keeps the layout before it', async () => {
    const { connections, asked } = aDatabaseHolding({
      tables: ['ledger_layout'],
      layoutsRead: [6, 6],
      refusing: 'INSERT INTO marks',
    });

    await expect(postgresqlLayoutCarried(connections, [], { kept: 7, floor: 6, steps: [marked] })).rejects.toThrow(
      'The database refused INSERT INTO marks',
    );
    expect(asked.slice(-2)).toEqual([told('ROLLBACK'), told('released')]);
  });
});

describe('a fact as the ledger keeps it on PostgreSQL, read as it opens', () => {
  it('has its data as the text of its JSON in an object, and its metadata as JSON the driver has parsed', () => {
    expect([
      postgresqlLayout.storedData({ json: '{"by":2}' }),
      postgresqlLayout.storedMetadata({ at: '2026-10-29T10:00:00.000Z', by: 'user-1' }),
    ]).toEqual([{ by: 2 }, { at: '2026-10-29T10:00:00.000Z', by: 'user-1' }]);
  });
});
