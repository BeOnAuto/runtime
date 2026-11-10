import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { runTallyRows, topicRows } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import type { Query } from '../postgresql-reads/recorded-parts.ts';
import { formattedFor } from '../postgresql-reads/recorded-parts.ts';
import { postgresqlProjectionDialect, postgresqlProjectionsOf } from './postgresql-projections.ts';

interface Asked {
  readonly text: string;
  readonly values: readonly unknown[];
}

function answering(rows: readonly unknown[]): { readonly query: Query; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    query: (text, values) => {
      asked.push({ text: text.replaceAll(/\s+/gu, ' ').trim(), values });
      return Promise.resolve(rows);
    },
  };
}

const stored = {
  playbook_key: 'playbook/acme/alpha/',
  row_key: 'r1',
  fn: 'triage',
  began_at: 1000,
  status: 'started',
  facts: 1,
  open: true,
  due_at: 61_000,
  last_message: 'm1',
};

const alpha = { org: 'acme', playbook: 'alpha' };

function readerOf(query: Query) {
  return postgresqlProjectionsOf({ projections: [runTallyRows, topicRows] }).readerOn({
    query: formattedFor(query),
    command: formattedFor(query),
  });
}

describe('the reads of a projection on PostgreSQL', () => {
  it('bind every value, read whole numbers as numbers and booleans as booleans', async () => {
    const { query, asked } = answering([stored]);
    const reader = readerOf(query);

    const rows = await Effect.runPromise(
      reader.readProjectedRows('run_tallies', alpha, {
        where: [{ column: 'open', equals: true }],
        orderBy: ['began_at'],
        order: 'desc',
        after: [2000, 'r9'],
        limit: 20,
      }),
    );

    expect(rows).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        key: 'r1',
        row: {
          fn: 'triage',
          began_at: 1000,
          status: 'started',
          facts: 1,
          open: true,
          due_at: 61_000,
          last_message: 'm1',
        },
      },
    ]);
    expect(asked).toEqual([
      {
        text: 'SELECT playbook_key, row_key, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message FROM run_tallies_2 WHERE playbook_key = $1 AND open = $2 AND (began_at, row_key) < ($3, $4) ORDER BY began_at DESC NULLS LAST, row_key DESC NULLS LAST LIMIT $5',
        values: ['playbook/acme/alpha/', true, 2000, 'r9', 20],
      },
    ]);
  });
});

describe('the counts and due times of a projection on PostgreSQL', () => {
  it('count, read what is due across playbooks, and the soonest due time', async () => {
    const counts = answering([{ count: 3 }]);
    const due = answering([stored]);
    const soonest = answering([{ due: 61_000 }]);

    expect(await Effect.runPromise(readerOf(counts.query).countProjectedRows('run_tallies', alpha, []))).toBe(3);
    expect(
      await Effect.runPromise(
        readerOf(due.query).readDueRows('run_tallies', {
          column: 'due_at',
          through: 70_000,
          limit: 256,
        }),
      ),
    ).toMatchObject([{ key: 'r1', row: { open: true } }]);
    expect(await Effect.runPromise(readerOf(soonest.query).nextDueOf('run_tallies', 'due_at', 0))).toBe(61_000);
    expect([...counts.asked, ...due.asked, ...soonest.asked].map(({ text }) => text)).toEqual([
      'SELECT CAST(count(*) AS INTEGER) AS count FROM run_tallies_2 WHERE playbook_key = $1',
      'SELECT playbook_key, row_key, fn, began_at::float8 AS began_at, status, facts::float8 AS facts, open, due_at::float8 AS due_at, last_message FROM run_tallies_2 WHERE due_at IS NOT NULL AND due_at <= $1 ORDER BY due_at, playbook_key, row_key LIMIT $2',
      'SELECT min(due_at)::float8 AS due FROM run_tallies_2 WHERE due_at IS NOT NULL AND due_at > $1',
    ]);
  });

  it('fail for a column the projection does not have', async () => {
    const { query } = answering([]);

    const read = await Effect.runPromiseExit(
      readerOf(query).countProjectedRows('run_tallies', alpha, [{ column: 'state', equals: 'open' }]),
    );

    expect(Exit.isFailure(read)).toBe(true);
  });

  it('bind a boolean as PostgreSQL takes it', () => {
    expect([postgresqlProjectionDialect.booleanOf(true), postgresqlProjectionDialect.booleanOf(false)]).toEqual([
      true,
      false,
    ]);
  });
});

describe('the advance of a row of a projection on PostgreSQL', () => {
  it('updates the columns the reader advances of one row, binding every value, and nothing else', async () => {
    const { query, asked } = answering([]);

    await Effect.runPromise(
      readerOf(query).advanceRow('topics', alpha, 'spring', {
        set: { open: false, next_at: 9000 },
        when: [{ column: 'last_message', equals: 'm-1' }],
      }),
    );
    const refused = await Effect.runPromiseExit(
      readerOf(query).advanceRow('topics', alpha, 'spring', { set: { note: 'x' }, when: [] }),
    );

    expect(Exit.isFailure(refused)).toBe(true);
    expect(asked).toEqual([
      {
        text: 'UPDATE topics_2 SET open = $1, next_at = $2 WHERE playbook_key = $3 AND row_key = $4 AND last_message = $5',
        values: [false, 9000, 'playbook/acme/alpha/', 'spring', 'm-1'],
      },
    ]);
  });
});

function described(sql: SQL): string {
  return SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').trim();
}

interface Recorded {
  readonly execute: StatementExecutor;
  readonly queries: string[];
  readonly commands: string[];
}

function recordedAnswering(answers: (statement: string) => readonly unknown[]): Recorded {
  const queries: string[] = [];
  const commands: string[] = [];
  return {
    queries,
    commands,
    execute: {
      query: (sql) => {
        queries.push(described(sql));
        return Promise.resolve({ rows: answers(described(sql)) });
      },
      command: (sql) => {
        commands.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}

const keyed = postgresqlProjectionsOf({ projections: [topicRows] });

function noted(point: number, topic: string) {
  return {
    point: `7/${point}`,
    ordered: `${'7'.padStart(20, '0')}/${String(point).padStart(20, '0')}`,
    stream: `playbook/acme/alpha/notes/n${point}`,
    type: 'topic_opened',
    data: { json: JSON.stringify({ topic, at: point }) },
    metadata: { at: '2026-10-05T09:00:00.000Z', by: 'topics' },
    position: 1,
  };
}

const appendedCount = 258;

function topicOf(index: number): string {
  return index < 256 ? `t${index % 2}` : 't2';
}

const appended = Array.from({ length: appendedCount }, (_, index) => ({
  ...noted(index + 1, topicOf(index)),
  ...(index === appendedCount - 1 ? { stream: 'x' } : {}),
}));

const sized = Array.from({ length: appendedCount }, (_, index) => ({
  point: `7/${index + 1}`,
  size: JSON.stringify({ topic: topicOf(index), at: index + 1 }).length,
}));

function positionAfter(statement: string, comparison: string): number | undefined {
  const found = new RegExp(`${comparison} \\(split_part\\("\\d+/(\\d+)"`, 'u').exec(statement);
  return found === null ? undefined : Number(found[1]);
}

function listsSizes(statement: string): boolean {
  return statement.includes(' AS size');
}

function limitOf(statement: string): number {
  return Number(/LIMIT (\d+)/u.exec(statement)?.[1] ?? appendedCount);
}

function tableAnswering(statement: string): readonly unknown[] {
  const after = positionAfter(statement, '>') ?? 0;
  const through = positionAfter(statement, '<=') ?? appendedCount;
  const table: readonly unknown[] = listsSizes(statement) ? sized : appended;
  return statement.includes('ORDER BY m.transaction_id')
    ? table.slice(after, through).slice(0, limitOf(statement))
    : [];
}

function sizesListedInOrder(statement: string): boolean {
  return statement.includes('ORDER BY m.transaction_id') && listsSizes(statement);
}

function messagesReadInOrder(statement: string): boolean {
  return statement.includes('ORDER BY m.transaction_id') && statement.includes(' AS data');
}

function readThroughTheLastListed(statement: string): boolean {
  return statement.includes('<= (split_part(') && !statement.includes('LIMIT');
}

function sizedAfterItsLimit(statement: string): boolean {
  return /^SELECT [^()]*\(octet_length[^]*AS size FROM \(SELECT m\.transaction_id, [^]* LIMIT \d+\) AS m ORDER BY m\.transaction_id, m\.global_position$/u.test(
    statement,
  );
}

describe('the fill of a projection keyed by its mapping on PostgreSQL', () => {
  it('lists as many as the batch before showed fit, sizing those alone, reads through the last it listed, and folds every message in order', async () => {
    const fill = recordedAnswering(tableAnswering);

    await keyed.afterTheSchema({ execute: fill.execute });

    expect(
      fill.queries.filter((statement) => sizesListedInOrder(statement)).map((statement) => limitOf(statement)),
    ).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256]);
    expect(
      fill.queries
        .filter((statement) => sizesListedInOrder(statement))
        .every((statement) => sizedAfterItsLimit(statement)),
    ).toBe(true);
    expect(
      fill.queries
        .filter((statement) => messagesReadInOrder(statement))
        .every((statement) => readThroughTheLastListed(statement)),
    ).toBe(true);
    expect(fill.queries.find((statement) => statement.includes('split_part("0/0"'))).toContain(
      `split_part(m.stream_id, '/', 4) IN (SELECT jsonb_array_elements_text("[\\"runs\\",\\"notes\\"]"::jsonb))`,
    );
    expect(fill.commands.filter((command) => command.startsWith('INSERT INTO topics_2')).join(' ')).toMatch(
      /"t0".*"t1".*"t2"/u,
    );
  });
});
