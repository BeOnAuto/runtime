import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { runTallies, type RunFact } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { contentTableNames } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import type { Query } from '../postgresql-reads/postgresql-recorded.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';
import {
  emmettsMigrationLock,
  longestMigrationLockWaitMs,
  migrationLockTakenWithin,
  postgresqlRunOutcomesReader,
} from './postgresql-run-outcomes.ts';

const tallied = postgresqlProjectionsOf({ runOutcomes: runTallies });

const untallied = postgresqlProjectionsOf({});

interface Recording {
  readonly execute: StatementExecutor;
  readonly commands: string[];
}

type Answers = (statement: string) => readonly unknown[];

function described(sql: SQL): string {
  return SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').trim();
}

function recording(answers: Answers): Recording {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: (sql) => Promise.resolve({ rows: answers(described(sql)) }),
      command: (sql) => {
        commands.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}

const began: RunFact = { type: 'run_began', data: { at: '2026-10-01T09:00:00.000Z', fn: 'triage' } };

const indexes = (
  'ledger_messages_by_playbook ledger_messages_by_playbook_and_time ledger_messages_by_stream ledger_first_messages_by_kind ' +
  'ledger_messages_by_org ledger_messages_by_org_and_correlation ledger_definition_streams ledger_messages_by_org_and_id'
)
  .split(' ')
  .map((name) => ({ name }));

const ownTables =
  'recorded_content_heads_by_upload recorded_content_heads_expiring kept_secrets webhooks_received webhooks_received_kept_until definition_names_1 definition_names_1_by_definition run_ids_1 projection_checkpoints';

const ownRows = [...contentTableNames, ...ownTables.split(' ')].map((name) => ({
  name,
  projection: 'run_outcomes',
  version: 5,
  folded_through: null,
}));

function aLedgerWithOneRun(tables: readonly string[]): Answers {
  return (statement) => {
    if (statement.includes('ledger_messages_by_playbook')) {
      return indexes;
    }
    if (
      /content_chunks|_by_upload|kept_secrets|webhooks_received|definition_names|run_ids|checkpoints/u.test(statement)
    ) {
      return ownRows;
    }
    if (statement.includes('pg_class')) {
      return tables.map((name) => ({ name }));
    }
    return [];
  };
}

const keptRow =
  'INSERT INTO run_outcomes_5 (playbook_key, row_key, started_day, started_at, last_started_at, definition_type, name, status, duration_ms, input_tokens, output_tokens, cached_tokens, cost_micro_usd) VALUES ("definition/acme/d1/", "r1", "2026-10-01", "2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "tally", "triage", "started", null, null, null, null, null) ON CONFLICT (playbook_key, row_key) DO UPDATE SET started_day = excluded.started_day,';

describe('the table of the outcomes of runs on PostgreSQL, as the ledger opens', () => {
  it("is created after the playbook's indexes, in the transaction of the migration, and recorded at the start of the store", async () => {
    const { execute, commands } = recording(aLedgerWithOneRun([]));

    await tallied.afterTheSchema({ execute });

    expect(commands.map((command) => command.split(' ').slice(0, 6).join(' '))).toEqual([
      'CREATE TABLE IF NOT EXISTS run_outcomes_5',
      'CREATE INDEX IF NOT EXISTS run_outcomes_5_by_playbook_and_day',
      'INSERT INTO projection_checkpoints (projection, version, folded_through)',
    ]);
    expect(commands[2]).toContain('VALUES ("run_outcomes", 5, "0/0")');
  });

  it('is left as it is when it is found, and never made by a ledger without the projection', async () => {
    const found = recording(aLedgerWithOneRun(['run_outcomes_5']));
    const without = recording(aLedgerWithOneRun([]));

    await tallied.afterTheSchema({ execute: found.execute });
    await untallied.afterTheSchema({ execute: without.execute });

    expect([found.commands, without.commands]).toEqual([[], []]);
  });
});

describe('the projection of the outcomes of runs on PostgreSQL', () => {
  it('reads each message out of the wrapper it is stored in, and keeps the row of its run', async () => {
    const { execute, commands } = recording(() => []);
    const [registration] = tallied.registrations;
    const message = {
      type: 'run_began',
      data: { json: JSON.stringify(began.data) },
      metadata: {
        streamName: 'definition/acme/d1/runs/r1',
        messageId: 'm1',
        streamPosition: 1n,
        at: '2026-10-01T09:00:00.000Z',
        by: 'tallies',
      },
    };

    await registration?.projection.handle([message], { execute });

    expect(registration?.projection.canHandle).toEqual(['run_began', 'run_ended']);
    expect(commands[0]?.startsWith(keptRow)).toBe(true);
    expect(untallied.registrations).toEqual([]);
  });
});

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(rows: readonly unknown[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text: text.replaceAll(/\s+/gu, ' '), values });
      return Promise.resolve(rows);
    },
  };
}

const group = {
  day: '2026-10-01',
  definition_type: 'tally',
  name: 'triage',
  status: 'succeeded',
  runs: 2,
  input_tokens: 42,
  output_tokens: 40,
  cached_tokens: 2,
  cost_micro_usd: 1500,
  durations: [120, 80],
};

const unpriced = { ...group, status: 'rejected', runs: 1, cost_micro_usd: null, durations: [] };

describe('the read of the outcomes of runs on PostgreSQL', () => {
  it('groups the rows of the playbook over the days of the window by day, function and status, in one statement', async () => {
    const { query, asked } = answering([group, unpriced]);
    const read = postgresqlRunOutcomesReader(query);
    const window = { from: '2026-10-01', to: '2026-10-07' };

    const groups = await read('playbook/acme/alpha/', window, { definitionType: 'tally', name: 'triage' });
    await read('playbook/acme/alpha/', window, {});

    expect(groups).toEqual([
      {
        day: '2026-10-01',
        definitionType: 'tally',
        name: 'triage',
        status: 'succeeded',
        runs: 2,
        inputTokens: 42,
        outputTokens: 40,
        cachedTokens: 2,
        costMicroUsd: 1500,
        durations: [120, 80],
      },
      expect.objectContaining({ status: 'rejected', costMicroUsd: null }),
    ]);
    expect(asked.map(({ values }) => values)).toEqual([
      ['playbook/acme/alpha/', '2026-10-01', '2026-10-07', 'tally', 'triage'],
      ['playbook/acme/alpha/', '2026-10-01', '2026-10-07'],
    ]);
    expect(asked[0]?.text).toContain(
      'WHERE playbook_key IN (SELECT definition_key FROM definition_names_1 WHERE playbook_key = $1) AND started_day BETWEEN $2 AND $3 AND definition_type = $4 AND name = $5 GROUP BY started_day, definition_type, name, status',
    );
    expect(asked[1]?.text).toContain('BETWEEN $2 AND $3 GROUP BY');
    expect(asked[0]?.text).toContain('sum(cost_micro_usd)::float8 AS cost_micro_usd');
  });
});

interface HeldLock {
  readonly execute: StatementExecutor;
  readonly tries: () => readonly string[];
}

function aLockHeldWhile(held: (tries: number) => boolean): HeldLock {
  const tries: string[] = [];
  return {
    tries: () => tries,
    execute: {
      query: (sql) => {
        tries.push(described(sql));
        return Promise.resolve({ rows: [{ locked: !held(tries.length) }] });
      },
      command: (sql) => Promise.reject(new Error(`The wait for the lock commands nothing: ${described(sql)}`)),
    },
  };
}

function aFakeClock() {
  const clock = { at: 0 };
  return {
    elapsed: () => clock.at,
    waiting: {
      mostWaitMs: longestMigrationLockWaitMs,
      now: () => clock.at,
      pause: (milliseconds: number) => {
        clock.at += milliseconds;
        return Promise.resolve();
      },
    },
  };
}

const lockTried = `SELECT pg_try_advisory_xact_lock(${emmettsMigrationLock}) AS locked`;

describe('the wait of a server that starts for the migration lock of the ledger on PostgreSQL', () => {
  it('takes the lock the migrator takes, in the migration, trying again every 100 ms until it is free', async () => {
    const held = aLockHeldWhile((tries) => tries < 2);

    await migrationLockTakenWithin()({ execute: held.execute });

    expect(held.tries()).toEqual([lockTried, lockTried]);
  });

  it('waits past the 10 s the migrator itself waits, while another server fills the ledger, and goes on once it is done', async () => {
    const clock = aFakeClock();
    const held = aLockHeldWhile(() => clock.elapsed() < 12_000);

    await migrationLockTakenWithin(clock.waiting)({ execute: held.execute });

    expect({ elapsed: clock.elapsed(), tries: held.tries().length }).toEqual({ elapsed: 12_000, tries: 121 });
  });

  it('stops the start, saying why, when the lock is still held after 60 s', async () => {
    const clock = aFakeClock();
    const held = aLockHeldWhile(() => true);

    await expect(migrationLockTakenWithin(clock.waiting)({ execute: held.execute })).rejects.toThrow('60 s');
    expect(clock.elapsed()).toBe(longestMigrationLockWaitMs);
  });
});
