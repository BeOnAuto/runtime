import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import type { IndexExecutor } from '../recorded/missing-indexes.ts';
import { createPostgreSQLPlaybookIndexes } from './playbook-indexes.ts';
import { postgresqlRecordedStore, type Query } from './postgresql-recorded.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(...answers: readonly (readonly unknown[])[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text, values });
      return Promise.resolve(answers[asked.length - 1] ?? []);
    },
  };
}

const alpha = 'playbook/acme/alpha/';

const at = '2026-10-05T09:00:00.000Z';

function examined(transaction: string, position: string, wanted: boolean, order: number) {
  const stream = `${alpha}notes`;
  const lineage = {
    id: `message-${position}`,
    metadata: { at, by: 'tester', causationId: null, correlationId: 'r1' },
    correlation: 'r1',
  };
  return {
    transaction,
    position,
    stream,
    version: Number(position) - 20,
    type: 'noted',
    recorded: at,
    ...lineage,
    wanted,
    size: wanted ? 10 : 0,
    examined: order,
  };
}

function stored(transaction: string, position: string, detail: string) {
  return { transaction, position, data: { json: JSON.stringify({ type: 'noted', detail }) } };
}

function run(transaction: string, position: string, latest: readonly [string, string, string]) {
  return {
    ...examined(transaction, position, true, 1),
    latest_transaction: latest[0],
    latest_position: latest[1],
    latest_version: 2,
    latest_type: latest[2],
    latest_size: 5,
    latest_recorded: at,
    latest_id: `message-${latest[1]}`,
    latest_metadata: { at, by: 'tester', causationId: `message-${position}`, correlationId: 'r2' },
    latest_correlation: 'r2',
  };
}

const theHorizon = 'pg_snapshot_xip(pg_current_snapshot())';

const playbookKey = "substring(stream_id FROM '^(?:[^/]*/){3}')";

const kindKey = "substring(stream_id FROM '^(?:[^/]*/){4}')";

const correlation = "(message_metadata ->> 'correlationId')";

describe('the read of what a playbook recorded on PostgreSQL, oldest first', () => {
  it('walks the playbook index in transaction id then position, behind the oldest write open in its database, once it has looked up the writes open in others', async () => {
    const { query, asked } = answering(
      [{ id: '9' }],
      [
        examined('11', '21', false, 1),
        examined('11', '22', true, 2),
        examined('12', '23', true, 3),
        examined('12', '24', true, 4),
      ],
      [stored('11', '22', 'second'), stored('12', '23', 'third')],
    );

    const page = await postgresqlRecordedStore(query).readRecorded(
      alpha,
      { kind: 'everything' },
      { order: 'asc', limit: 2, after: ['10', '20'], types: ['noted'] },
    );

    expect(page.records.map(({ point, data }) => [point, data])).toEqual([
      [['11', '22'], { type: 'noted', detail: 'second' }],
      [['12', '23'], { type: 'noted', detail: 'third' }],
    ]);
    expect(page.resumeAfter).toEqual(['12', '23']);
    expect(asked[0]?.text).toMatch(/FROM pg_stat_activity\s+WHERE .* datname IS DISTINCT FROM current_database/u);
    expect(asked[1]?.text).toContain('WHERE running.xid::text::bigint % 4294967296 <> ALL($3::bigint[])');
    expect(asked[1]?.text).toContain('AND (transaction_id, global_position) > ($4::xid8, $5::bigint)');
    expect(asked[1]?.text).toContain(`WHERE ${playbookKey} = ANY($7::text[])`);
    expect(asked[1]?.text).toContain(`ORDER BY ${playbookKey} ASC, transaction_id ASC, global_position ASC`);
    expect(asked[1]?.text).toContain('ORDER BY transaction_id ASC, global_position ASC');
    expect(asked[1]?.values).toEqual([['noted'], 'emt:default', ['9'], '10', '20', 1001, [alpha], 1000, 4]);
    expect(asked[2]?.values).toEqual([['11', '12'], ['22', '23'], 'emt:default']);
  });
});

describe('the size a read on PostgreSQL measures', () => {
  it('measures the records of the types whose data the page loads, and none for a page of heads', async () => {
    const { query, asked } = answering([], [], [], [], [], []);
    const store = postgresqlRecordedStore(query);

    await store.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 5, dataOf: ['noted'] });
    await store.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 5, dataOf: [] });
    await store.readRecorded(alpha, { kind: 'runs' }, { order: 'desc', limit: 5, dataOf: ['noted'] });
    await store.readRecorded(alpha, { kind: 'runs' }, { order: 'desc', limit: 5, dataOf: [] });

    expect(asked[1]?.text).toContain(
      "CASE WHEN wanted AND type = ANY($4::text[]) THEN octet_length(numbered.message_data ->> 'json') ELSE 0 END AS size",
    );
    expect(asked[1]?.values[3]).toEqual(['noted']);
    expect(asked[3]?.text).toContain('examined::int AS examined, 0 AS size');
    expect(asked[3]?.text).not.toContain('octet_length');
    expect(asked[4]?.text).toContain(
      "CASE WHEN TRUE AND f.of_the_definition AND f.type = ANY($1::text[]) THEN octet_length(f.message_data ->> 'json') ELSE 0 END AS size",
    );
    expect(asked[4]?.text).toContain(
      "THEN CASE WHEN TRUE AND f.of_the_definition AND latest.message_type = ANY($1::text[]) THEN octet_length(latest.message_data ->> 'json')",
    );
    expect(asked[5]?.text).not.toContain('octet_length');
  });
});

describe('a read of one run on PostgreSQL, newest first', () => {
  it('walks each of its two streams by their index and merges them, after a cursor and from a time, with no horizon', async () => {
    const { query, asked } = answering(
      [{ transaction: '7', position: '8' }],
      [examined('9', '10', true, 1)],
      [stored('9', '10', 'only')],
    );

    const page = await postgresqlRecordedStore(query).readRecorded(
      alpha,
      { kind: 'run', run: 'r1' },
      { order: 'desc', limit: 5, since: at, after: ['30', '40'] },
    );

    expect(page.records.map(({ data }) => data)).toEqual([{ type: 'noted', detail: 'only' }]);
    expect(asked[0]?.values).toEqual([alpha, 'emt:default', at]);
    expect(asked[1]?.text).not.toContain(theHorizon);
    expect(asked[1]?.text).toContain('UNION ALL');
    expect(asked[1]?.text).toContain('AND (transaction_id, global_position) < ($2::xid8, $3::bigint)');
    expect(asked[1]?.text).toContain('AND (transaction_id, global_position) >= ($4::xid8, $5::bigint)');
    expect(asked[1]?.text).toContain('WHERE stream_id = ANY($7::text[])');
    expect(asked[1]?.text).toContain('ORDER BY stream_id DESC, transaction_id DESC, global_position DESC');
    expect(asked[1]?.text).toContain('ORDER BY transaction_id DESC, global_position DESC');
    expect(asked[1]?.values).toEqual([
      'emt:default',
      '30',
      '40',
      '7',
      '8',
      6,
      [`${alpha}runs/r1`],
      [`${alpha}run-logs/r1`],
      5,
      6,
    ]);
  });
});

describe('a read on PostgreSQL by correlation, from inside a record', () => {
  it('walks the playbook and the correlation through their index, from that record on, in either order', async () => {
    const { query, asked } = answering([], [examined('9', '10', true, 1)], [stored('9', '10', 'only')], []);
    const store = postgresqlRecordedStore(query);

    const page = await store.readRecorded(
      alpha,
      { kind: 'correlated', correlation: 'r1' },
      { order: 'asc', limit: 5, at: ['9', '10'] },
    );
    await store.readRecorded(
      alpha,
      { kind: 'correlated', correlation: 'r1' },
      { order: 'desc', limit: 5, at: ['9', '10'] },
    );

    expect(page.records.map(({ id, correlationId }) => [id, correlationId])).toEqual([['message-10', 'r1']]);
    expect(asked[1]?.text).toContain('AND (transaction_id, global_position) >= ($3::xid8, $4::bigint)');
    expect(asked[1]?.text).toContain(`WHERE ${playbookKey} = ANY($6::text[]) AND ${correlation} = ANY($7::text[])`);
    expect(asked[1]?.text).toContain(
      `ORDER BY ${playbookKey} ASC, ${correlation} ASC, transaction_id ASC, global_position ASC`,
    );
    expect(asked[3]?.text).toContain('AND (transaction_id, global_position) <= ($2::xid8, $3::bigint)');
  });
});

describe('a read on PostgreSQL from a time', () => {
  it('answers nothing when nothing was recorded from the time asked', async () => {
    const { query, asked } = answering([]);

    expect(
      await postgresqlRecordedStore(query).readRecorded(
        alpha,
        { kind: 'everything' },
        { order: 'asc', limit: 5, since: at },
      ),
    ).toEqual({
      records: [],
    });
    expect(asked).toHaveLength(1);
  });
});

describe('a read of runs on PostgreSQL', () => {
  it('gives the first and the latest message of each run, and the first alone for a run of one message', async () => {
    const { query, asked } = answering(
      [run('3', '4', ['3', '4', 'run_started']), { ...run('1', '2', ['5', '6', 'run_succeeded']), examined: 2 }],
      [stored('3', '4', 'r2'), stored('1', '2', 'r1'), stored('5', '6', 'r1 done')],
    );

    const runsOnly = { kind: 'runs', notBeginningWith: ['run_cancel_requested'] } as const;
    const page = await postgresqlRecordedStore(query).readRecorded(alpha, runsOnly, { order: 'desc', limit: 5 });

    expect(page.records.map(({ type, data, id, causationId }) => [type, data, id, causationId])).toEqual([
      ['noted', { type: 'noted', detail: 'r2' }, 'message-4', null],
      ['noted', { type: 'noted', detail: 'r1' }, 'message-2', null],
      ['run_succeeded', { type: 'noted', detail: 'r1 done' }, 'message-6', 'message-2'],
    ]);
    expect(asked[0]?.text).toContain(`WHERE ${kindKey} = ANY($2::text[]) AND stream_position = 1`);
    expect([asked[0]?.text.includes('AND NOT message_type = ANY($3::text[])'), asked[0]?.values[2]]).toEqual([
      true,
      ['run_cancel_requested'],
    ]);
    expect(asked[0]?.text).toContain(`ORDER BY ${kindKey} DESC, transaction_id DESC, global_position DESC`);
  });
});

function executorFinding(names: readonly string[]): { readonly execute: IndexExecutor; readonly commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' '));
        return Promise.resolve();
      },
    },
  };
}

describe("the playbook's indexes on PostgreSQL", () => {
  it('index the playbook in order, by time and by correlation, each stream in order, its messages by playbook and kind and by id and its definition streams by type, then analyse', async () => {
    const { execute, commands } = executorFinding([]);

    await createPostgreSQLPlaybookIndexes({ execute });

    expect(commands).toEqual([
      "CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){3}')), transaction_id, global_position)",
      "CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook_and_time ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){3}')), created, transaction_id, global_position)",
      'CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, transaction_id, global_position)',
      "CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){4}')), stream_position, transaction_id, global_position)",
      "CREATE INDEX IF NOT EXISTS ledger_messages_by_playbook_and_correlation ON emt_messages ((substring(stream_id FROM '^(?:[^/]*/){3}')), (message_metadata ->> 'correlationId'), transaction_id, global_position)",
      "CREATE INDEX IF NOT EXISTS ledger_definition_streams ON emt_streams ((substring(stream_id FROM '^(?:[^/]*/){3}definitions/([^/]+)$'))) WHERE (substring(stream_id FROM '^(?:[^/]*/){3}definitions/([^/]+)$')) IS NOT NULL",
      'CREATE INDEX IF NOT EXISTS ledger_messages_by_id ON emt_messages (message_id)',
      'ANALYZE emt_messages, emt_streams',
    ]);
  });

  it('are created only when missing, so a start that finds them issues no CREATE and analyses nothing', async () => {
    const all = [
      'ledger_messages_by_playbook',
      'ledger_messages_by_playbook_and_time',
      'ledger_messages_by_stream',
      'ledger_first_messages_by_kind',
      'ledger_messages_by_playbook_and_correlation',
      'ledger_definition_streams',
      'ledger_messages_by_id',
    ];
    const present = executorFinding(all);
    const oneMissing = executorFinding(all.filter((name) => name !== 'ledger_messages_by_stream'));

    await createPostgreSQLPlaybookIndexes({ execute: present.execute });
    await createPostgreSQLPlaybookIndexes({ execute: oneMissing.execute });

    expect([present.commands, oneMissing.commands]).toEqual([
      [],
      [
        'CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, transaction_id, global_position)',
        'ANALYZE emt_messages, emt_streams',
      ],
    ]);
  });
});
