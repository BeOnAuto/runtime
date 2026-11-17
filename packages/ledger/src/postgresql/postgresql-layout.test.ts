import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { Ledger } from '@on.auto/operations';
import { Cause, Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { statement } from '../connection/statement.ts';
import { contentTableNames } from '../content/content-tables.ts';
import type { ContentConnections } from '../content/postgresql-content.ts';
import type { StatementExecutor } from '../event-store.ts';
import { postgresqlLayout } from '../layout/layout-dialects.ts';
import type { LayoutStep } from '../layout/layout-steps.ts';
import { ledgerLayout } from '../layout/ledger-layout.ts';
import { unreachableDatabase } from '../testing/index.ts';
import { postgresqlLayoutCarried, postgresqlLayoutKept } from './postgresql-layout.ts';
import { plainPoolsOn, postgresqlEventStore, postgresqlLedgerLayer } from './postgresql-ledger.ts';
import { emmettsMigrationLock } from './postgresql-run-outcomes.ts';
import { postgresqlSchemaCreated } from './postgresql-schema.ts';

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

function described(sql: SQL): string {
  return SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').trim();
}

function executorFinding(names: readonly string[]): {
  readonly execute: StatementExecutor;
  readonly commands: string[];
} {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(described(sql).split(' (')[0] ?? '');
        return Promise.resolve();
      },
    },
  };
}

const firstContentTable = 'CREATE TABLE IF NOT EXISTS recorded_content_chunks';

const theContentTables = [
  firstContentTable,
  'CREATE TABLE IF NOT EXISTS recorded_content_heads',
  'CREATE TABLE IF NOT EXISTS recorded_content_places',
];

const theContentIndexes = [
  'CREATE INDEX IF NOT EXISTS recorded_content_heads_by_upload ON recorded_content_heads',
  'CREATE INDEX IF NOT EXISTS recorded_content_heads_expiring ON recorded_content_heads',
];

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

describe("the ledger's own schema on PostgreSQL", () => {
  it("creates the playbook's indexes, the tables of the content it keeps and their indexes, then the tables of its kept secrets, of the webhooks it received, of the names of definitions and of the checkpoints of projections, each only when missing", async () => {
    const empty = executorFinding([]);
    const found = executorFinding([
      ...contentTableNames,
      'recorded_content_heads_by_upload',
      'recorded_content_heads_expiring',
      'kept_secrets',
      'webhooks_received',
      'webhooks_received_kept_until',
      'definition_names_1',
      'definition_names_1_by_definition',
      'projection_checkpoints',
    ]);

    await postgresqlSchemaCreated(empty.execute);
    await postgresqlSchemaCreated(found.execute);
    const indexes = empty.commands.slice(0, empty.commands.indexOf(firstContentTable));

    expect(indexes.filter((command) => command.startsWith('CREATE INDEX IF NOT EXISTS ledger_'))).toHaveLength(7);
    expect(indexes.filter((command) => command.includes('content'))).toEqual([]);
    expect(empty.commands.slice(indexes.length)).toEqual([
      ...theContentTables,
      ...theContentIndexes,
      'CREATE TABLE IF NOT EXISTS kept_secrets',
      'CREATE TABLE IF NOT EXISTS webhooks_received',
      'CREATE INDEX IF NOT EXISTS webhooks_received_kept_until ON webhooks_received',
      'CREATE TABLE IF NOT EXISTS definition_names_1',
      'CREATE UNIQUE INDEX IF NOT EXISTS definition_names_1_by_definition ON definition_names_1',
      'CREATE TABLE IF NOT EXISTS projection_checkpoints',
    ]);
    expect(
      found.commands.filter((command) =>
        /content|kept_secrets|webhooks_received|definition_names|projection_checkpoints/u.test(command),
      ),
    ).toEqual([]);
  });
});

describe('a ledger on PostgreSQL that cannot be reached', () => {
  it('fails to build, with a defect naming the address it tried and no credential', async () => {
    const { url, port, password } = await unreachableDatabase();

    const cause = await Effect.runPromise(
      Effect.provide(Ledger, postgresqlLedgerLayer({ pools: plainPoolsOn(url) })).pipe(Effect.sandbox, Effect.flip),
    );

    expect({ dies: Cause.hasDies(cause), fails: Cause.hasFails(cause) }).toEqual({ dies: true, fails: false });
    expect(Cause.pretty(cause)).toContain(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(Cause.pretty(cause)).not.toContain(password);
  });

  it('fails a read of what a playbook recorded with the error of the driver', async () => {
    const { url, port } = await unreachableDatabase();
    const lost: Readonly<Error>[] = [];
    const store = postgresqlEventStore({
      pools: plainPoolsOn(url),
      reportLostConnection: (error) => {
        lost.push(error);
      },
    });
    onTestFinished(() => store.close());

    await expect(
      store.readRecorded('playbook/acme/alpha/', { kind: 'everything' }, { order: 'asc', limit: 1 }),
    ).rejects.toThrow(`ECONNREFUSED 127.0.0.1:${port}`);
    expect(lost).toEqual([]);
  });
});
