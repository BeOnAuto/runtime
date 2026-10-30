import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { Ledger } from '@on.auto/operations';
import { Effect, type Layer } from 'effect';
import { Client } from 'pg';

import { plainPoolsOn, postgresqlLedgerLayer } from './src/postgresql/postgresql-ledger.ts';
import { cursorOf } from './src/recorded/cursor.ts';
import { ledgerLayer } from './src/sqlite3.ts';
import { openLedgerWith, type OpenLedger } from './src/testing/open-ledger.ts';
import { temporaryDatabase } from './src/testing/temporary-database.ts';

type AnyLedger = OpenLedger['ledger'];

type Selection = Parameters<AnyLedger['readRecorded']>[1];

type Page = Parameters<AnyLedger['readRecorded']>[2];

type Point = readonly string[];

type Case = readonly [label: string, playbook: string, selection: Selection, page: Page];

interface Row {
  readonly stream: string;
  readonly position: number;
  readonly type: string;
  readonly data: string;
  readonly metadata: string;
  readonly created: string;
}

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const runs = 10_000;

const largeRuns = 1_000;

const largeEvery = 200;

const largeInput = 262_144;

const runsInOneStatement = 100;

const largeRunsInOneStatement = 10;

const deepRun = 5_000;

function text(characters: number): string {
  return randomBytes(characters / 2).toString('hex');
}

function timeOf(second: number): string {
  return new Date(Date.UTC(2026, 0, 1) + second * 1000).toISOString();
}

function streamOf(playbook: string, run: number): string {
  return `playbook/o1/${playbook}/runs/${String(run).padStart(8, '0')}`;
}

interface Ending {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

function endingOf(run: number): Ending {
  if (run % 20 === 10) {
    return { type: 'run_rejected', data: { rejection: { reason: 'unavailable', detail: 'try again later' } } };
  }
  return run % 100 === 7
    ? { type: 'run_failed', data: {} }
    : { type: 'run_succeeded', data: { output: { text: text(640) }, record: {} } };
}

function rowsOfRun(playbook: string, run: number, inputCharacters: number): readonly Row[] {
  const created = timeOf(run);
  const metadata = JSON.stringify({
    at: created,
    by: 'user-1',
    runId: String(run).padStart(8, '0'),
    definitionType: run % 10 === 0 ? 'workflow' : 'reasoning',
    definitionName: `definition-${run % 10}`,
    definitionVersion: 1,
  });
  const start = { input: { text: text(inputCharacters) } };
  const ending = endingOf(run);
  const stream = streamOf(playbook, run);
  return [
    { stream, position: 1, type: 'run_started', data: JSON.stringify(start), metadata, created },
    { stream, position: 2, type: ending.type, data: JSON.stringify(ending.data), metadata, created },
  ];
}

function rowsOf(first: number, count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index) => first + index).flatMap((run) =>
    rowsOfRun('big', run, run % largeEvery === 13 ? largeInput : 320),
  );
}

function largeRowsOf(first: number, count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index) => first + index).flatMap((run) =>
    rowsOfRun('large', run, largeInput),
  );
}

function batches(total: number, size: number): readonly number[] {
  return Array.from({ length: Math.ceil(total / size) }, (_, index) => index * size);
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function aPage(order: 'asc' | 'desc', limit: number, more: Omit<Page, 'order' | 'limit'> = {}): Page {
  return { order, limit, ...more };
}

const notBeginningWith = ['run_cancel_requested'];

function runsOf(asked: Omit<Extract<Selection, { kind: 'runs' }>, 'kind'>): Selection {
  return { kind: 'runs', notBeginningWith, ...asked };
}

function cases(deepCursor: string): readonly Case[] {
  return [
    ['Runs, newest first', 'big', runsOf({}), aPage('desc', 20)],
    ['Runs that were rejected, newest first', 'big', runsOf({}), aPage('desc', 20, { types: ['run_rejected'] })],
    ['Runs of one type, newest first', 'big', runsOf({ definitionType: 'workflow' }), aPage('desc', 20)],
    ['Runs of one name, newest first', 'big', runsOf({ name: 'definition-3' }), aPage('desc', 20)],
    [
      'Runs of one type and name, newest first',
      'big',
      runsOf({ definitionType: 'workflow', name: 'definition-0' }),
      aPage('desc', 20),
    ],
    [
      'Runs of one type, deep page, newest first',
      'big',
      runsOf({ definitionType: 'workflow' }),
      aPage('desc', 20, { cursor: deepCursor }),
    ],
    ['Runs of one type, oldest first', 'big', runsOf({ definitionType: 'workflow' }), aPage('asc', 20)],
    ['Runs of one type, page of 100', 'big', runsOf({ definitionType: 'workflow' }), aPage('desc', 100)],
    [
      'Runs of one type that were rejected',
      'big',
      runsOf({ definitionType: 'workflow' }),
      aPage('desc', 20, { types: ['run_rejected'] }),
    ],
    ['Runs of a name none has, 1,000 examined', 'big', runsOf({ name: 'definition-none' }), aPage('desc', 20)],
    [
      'Runs of a name none has, 1,000 examined, each run with an input of 256 KiB',
      'large',
      runsOf({ name: 'definition-none' }),
      aPage('desc', 20),
    ],
    [
      'Runs of the type nine in ten have, 1,000 examined, each run with an input of 256 KiB',
      'large',
      runsOf({ definitionType: 'reasoning' }),
      aPage('desc', 20),
    ],
  ];
}

async function timed<A>(attempt: () => Promise<A>): Promise<{ readonly took: number; readonly answer: A }> {
  const started = performance.now();
  const answer = await attempt();
  return { took: performance.now() - started, answer };
}

async function measured(ledger: AnyLedger, [label, playbook, selection, page]: Case): Promise<string> {
  const read = () => Effect.runPromise(ledger.readRecorded({ org: 'o1', playbook }, selection, page));
  await Effect.runPromise(Effect.forEach([1, 2, 3], () => Effect.promise(read), { discard: true }));
  const reads = await Effect.runPromise(
    Effect.forEach(Array.from({ length: 20 }), () => Effect.promise(() => timed(read))),
  );
  const times = reads.map(({ took }) => took).toSorted((left, right) => left - right);
  const { records } = reads[0]?.answer ?? { records: [] };
  const listed = new Set(records.map(({ stream }) => stream)).size;
  const kibibytes = Math.round(JSON.stringify(records).length / 1024);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  return `| ${label} | ${median.toFixed(2)} | ${Math.max(...times).toFixed(2)} | ${listed} | ${kibibytes} KiB |`;
}

async function pagesOf(layer: Layer.Layer<Ledger>, deepPoint: Point): Promise<void> {
  const { ledger, dispose } = await openLedgerWith(layer);
  const lines = await Effect.runPromise(
    Effect.forEach(cases(cursorOf('playbook/o1/big/', deepPoint)), (each) =>
      Effect.promise(() => measured(ledger, each)),
    ),
  );
  write(['| Page | median ms | slowest ms | runs | data |', '| --- | --- | --- | --- | --- |', ...lines].join('\n'));
  await dispose();
}

async function measureSQLite(): Promise<void> {
  const { fileName, remove } = temporaryDatabase();
  const creating = await openLedgerWith(ledgerLayer({ fileName }));
  await creating.dispose();
  const database = new DatabaseSync(fileName);
  const insert = database.prepare(`INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind,
    message_data, message_metadata, message_schema_version, message_type, message_id, is_archived, created)
    VALUES (?, ?, 'emt:default', 'E', ?, ?, '1', ?, ?, 0, ?)`);
  database.exec('BEGIN');
  for (const row of [...rowsOf(0, runs), ...largeRowsOf(0, largeRuns)]) {
    insert.run(
      row.stream,
      row.position,
      row.data,
      row.metadata,
      row.type,
      `${row.stream}#${row.position}`,
      row.created.slice(0, 19).replace('T', ' '),
    );
  }
  database.exec('COMMIT');
  database.exec('ANALYZE');
  const deep = database
    .prepare('SELECT global_position AS p FROM emt_messages WHERE stream_id = ? AND stream_position = 1')
    .get(streamOf('big', deepRun))?.['p'];
  database.close();
  write(`SQLite, ${runs} runs and ${largeRuns} runs of 256 KiB in another playbook:`);
  await pagesOf(ledgerLayer({ fileName }), [String(deep)]);
  remove();
}

async function filledWithPostgreSQL(client: Readonly<Pick<Client, 'query'>>): Promise<void> {
  const inserted = (rows: readonly Row[]) =>
    client.query(
      `INSERT INTO emt_messages (stream_id, stream_position, partition, message_kind, message_data,
        message_metadata, message_schema_version, message_type, message_id, is_archived, transaction_id, created)
      SELECT r.stream, r.position, 'emt:default', 'E', jsonb_build_object('json', r.data), r.metadata::jsonb, '1',
        r.type, r.stream || '#' || r.position, false, pg_current_xact_id(), r.created::timestamptz
      FROM ROWS FROM (jsonb_to_recordset($1::jsonb)
          AS (stream text, position int, type text, data text, metadata text, created text))
        WITH ORDINALITY AS r(stream, position, type, data, metadata, created, n)
      ORDER BY r.n`,
      [JSON.stringify(rows)],
    );
  await client.query('SET synchronous_commit = off');
  await Effect.runPromise(
    Effect.forEach(
      batches(runs, runsInOneStatement),
      (first) => Effect.promise(() => inserted(rowsOf(first, runsInOneStatement))),
      {
        discard: true,
      },
    ),
  );
  await Effect.runPromise(
    Effect.forEach(
      batches(largeRuns, largeRunsInOneStatement),
      (first) => Effect.promise(() => inserted(largeRowsOf(first, largeRunsInOneStatement))),
      {
        discard: true,
      },
    ),
  );
  await client.query('VACUUM ANALYZE emt_messages');
}

async function measurePostgreSQL(): Promise<void> {
  const administration = new Client({ connectionString: postgresqlServer });
  await administration.connect();
  const name = `ledger_measure_run_filters_${Date.now()}`;
  await administration.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresqlServer);
  url.pathname = `/${name}`;
  const creating = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(url.href) }));
  await creating.dispose();
  const client = new Client({ connectionString: url.href });
  await client.connect();
  await filledWithPostgreSQL(client);
  const { rows } = await client.query<{ readonly t: string; readonly p: string }>(
    'SELECT transaction_id::text AS t, global_position::text AS p FROM emt_messages WHERE stream_id = $1 AND stream_position = 1',
    [streamOf('big', deepRun)],
  );
  write(`PostgreSQL, ${runs} runs and ${largeRuns} runs of 256 KiB in another playbook:`);
  await pagesOf(
    postgresqlLedgerLayer({ pools: plainPoolsOn(url.href) }),
    rows.flatMap(({ t, p }) => [t, p]),
  );
  await client.end();
  await administration.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await administration.end();
}

await measureSQLite();
if (postgresqlServer !== '') {
  await measurePostgreSQL();
}
