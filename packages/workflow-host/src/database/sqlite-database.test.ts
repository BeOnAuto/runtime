import { mkdirSync } from 'node:fs';

import { statement } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { aSQLiteFile, openedOn } from '../testing/host-files.ts';

const tablesOfTheHost = statement`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workflow_%' ORDER BY name`;

describe('the host database on SQLite', () => {
  it('keeps the tables of the host beside the ledger, in the same file', async () => {
    const file = aSQLiteFile();
    const first = await openedOn({ store: 'sqlite', file });
    const second = await openedOn({ store: 'sqlite', file });

    const tables = await Effect.runPromise(second.read(tablesOfTheHost));
    const ledger = await Effect.runPromise(
      first.read(statement`SELECT COUNT(*) AS streams FROM sqlite_master WHERE name = 'emt_streams'`),
    );

    expect(tables).toEqual(
      [
        'workflow_calls',
        'workflow_due',
        'workflow_followed_orgs',
        'workflow_followed_playbooks',
        'workflow_followed_scans',
        'workflow_leases',
        'workflow_listener_types',
        'workflow_listeners',
        'workflow_passed_runs',
        'workflow_pending_cancels',
        'workflow_reaction_backlog',
        'workflow_reaction_rates',
        'workflow_reaction_refusals',
        'workflow_runs',
        'workflow_settlements',
        'workflow_snapshot_chunks',
        'workflow_subscription_types',
        'workflow_subscriptions',
        'workflow_timers',
      ].map((name) => ({ name })),
    );
    expect(ledger).toEqual([{ streams: 1 }]);
  });

  it('makes the tables of its folders beside its own when it opens', async () => {
    const tableOfAFolder = statement`CREATE TABLE IF NOT EXISTS folder_rows (playbook_key TEXT NOT NULL PRIMARY KEY)`;
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() }, [tableOfAFolder]);

    const tables = await Effect.runPromise(
      database.read(statement`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'folder_rows'`),
    );

    expect(tables).toEqual([{ name: 'folder_rows' }]);
  });
});

describe('the host database on SQLite, in memory or refusing', () => {
  it('opens a private database in memory', async () => {
    const database = await openedOn({ store: 'sqlite', file: ':memory:' });

    expect(await Effect.runPromise(database.read(tablesOfTheHost))).toHaveLength(19);
  });

  it('fails a statement the database refuses with the error of the driver', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });

    const failure = await Effect.runPromise(Effect.flip(database.write(statement`INSERT INTO nowhere VALUES (${1})`)));

    expect(failure.detail).toContain('no such table: nowhere');
  });

  it('does not open a file that is a directory', async () => {
    const file = aSQLiteFile();
    mkdirSync(file);

    await expect(openedOn({ store: 'sqlite', file })).rejects.toThrow('SQLITE_CANTOPEN');
  });
});
