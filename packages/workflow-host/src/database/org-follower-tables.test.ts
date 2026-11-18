import { DatabaseSync } from 'node:sqlite';

import { recordedCursorOf, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { orgFollowerPlacedAt, orgFollowerTables, subscriptionTables } from './org-follower-tables.ts';

interface ADatabase {
  readonly ran: (made: Statement) => void;
  readonly all: (text: string, ...values: readonly string[]) => readonly unknown[];
}

function anEmptyDatabase(): ADatabase {
  const database = new DatabaseSync(':memory:');
  onTestFinished(() => {
    database.close();
  });
  return {
    ran: ({ strings, values }) => {
      database.prepare(strings.join('?')).run(...values);
    },
    all: (text, ...values) => database.prepare(text).all(...values),
  };
}

const ColumnRows = Schema.Array(Schema.Struct({ column: Schema.String }));

function columnsOf(database: ADatabase, table: string): readonly string[] {
  const rows = database.all(
    "SELECT name || CASE WHEN pk = 0 THEN '' ELSE ' key ' || pk END AS column FROM pragma_table_info(?) ORDER BY cid",
    table,
  );
  return Schema.decodeUnknownSync(ColumnRows)(rows).map(({ column }) => column);
}

const keptAsTheHostKeysThem: Readonly<Record<string, readonly string[]>> = {
  workflow_subscriptions: [
    'definition_key key 1',
    'reference key 2',
    'playbook_key',
    'version',
    'kind',
    'rule',
    'activated_by',
    'activated_at',
    'next_due',
    'running',
    'held_due',
  ],
  workflow_pauses: ['definition_key key 1'],
  workflow_subscription_types: ['definition_key key 1', 'type key 2', 'playbook_key'],
  workflow_followed_orgs: ['org key 1', 'cursor', 'delivered', 'attempts', 'waiting', 'checked'],
  workflow_held_playbooks: [
    'playbook_key key 1',
    'org',
    'cursor',
    'held_since',
    'held_until',
    'holds',
    'held_for',
    'delivered',
    'attempts',
  ],
};

describe('the tables a host keeps the schedules of an org and its follower in, as SQL run on a database alone', () => {
  it('are made on an empty SQLite database by their own statements, each table keyed as the host keys it', () => {
    const database = anEmptyDatabase();

    for (const made of [...subscriptionTables, ...orgFollowerTables]) {
      database.ran(made);
    }

    expect(
      Object.fromEntries(Object.keys(keptAsTheHostKeysThem).map((table) => [table, columnsOf(database, table)])),
    ).toEqual(keptAsTheHostKeysThem);
  });

  it('index the orgs that wait for a sweep by when a sweep took them, and the held playbooks by when they are due', () => {
    const database = anEmptyDatabase();
    for (const made of orgFollowerTables) {
      database.ran(made);
    }

    expect(
      database.all(
        "SELECT name, tbl_name AS table_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
      ),
    ).toEqual([
      { name: 'workflow_followed_orgs_by_check', table_name: 'workflow_followed_orgs' },
      { name: 'workflow_held_playbooks_due', table_name: 'workflow_held_playbooks' },
    ]);
  });

  it('places the follower of an org at a point of the log, by the cursor of that point over the org, with nothing held', () => {
    const database = anEmptyDatabase();
    for (const made of orgFollowerTables) {
      database.ran(made);
    }

    database.ran(orgFollowerPlacedAt('acme', ['42']));

    expect(database.all('SELECT * FROM workflow_followed_orgs')).toEqual([
      { org: 'acme', cursor: recordedCursorOf('acme', ['42']), delivered: null, attempts: 0, waiting: 0, checked: 0 },
    ]);
    expect(database.all('SELECT count(*) AS held FROM workflow_held_playbooks')).toEqual([{ held: 0 }]);
  });
});
