import { randomBytes } from 'node:crypto';

import { Effect, Function } from 'effect';
import { Client } from 'pg';

import type { StoredPageRequest } from './src/event-store.ts';
import { postgresqlRecordedStore, type Query } from './src/postgresql-reads/postgresql-recorded.ts';
import { plainPoolsOn, postgresqlEventStore } from './src/postgresql/postgresql-ledger.ts';

type Querying = Readonly<Pick<Client, 'query'>>;

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const playbookKey = 'playbook/o1/big/';

const records = 20;

const recordBytes = 1_400_000;

const warmReads = 3;

const measuredReads = 20;

const definitionTypes = ['definition_created', 'definition_updated', 'definition_retired'];

interface Explained {
  readonly 'Run Time': number;
  readonly Plan: { readonly 'Shared Hit Blocks': number; readonly 'Shared Read Blocks': number };
}

interface Examination {
  readonly milliseconds: number;
  readonly buffers: number;
}

const cases: readonly (readonly [string, StoredPageRequest])[] = [
  ['a page of heads, no data', { order: 'asc', limit: 100, dataOf: [] }],
  ["the follower's glance, the data of definitions alone", { order: 'asc', limit: 100, dataOf: definitionTypes }],
  ['every record with its data', { order: 'asc', limit: 100 }],
];

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function median(values: readonly number[]): number {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0;
}

function inTurn<A>(items: readonly A[], each: (item: A, index: number) => Promise<unknown>): Promise<unknown> {
  return Effect.runPromise(Effect.forEach(items, (item, index) => Effect.promise(() => each(item, index))));
}

function times(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index);
}

async function filled(client: Querying, url: string): Promise<void> {
  const store = postgresqlEventStore({ pools: plainPoolsOn(url), reportLostConnection: Function.constVoid });
  await store.migrate();
  await inTurn(times(records), (index) => {
    const text = randomBytes(recordBytes).toString('base64').slice(0, recordBytes);
    return store.append(`${playbookKey}events/e${index}`, [{ type: 'event_published', data: { text } }], {
      expectedVersion: 0,
      context: { at: new Date(0).toISOString(), by: 'measurer' },
    });
  });
  await store.close();
  await client.query('VACUUM ANALYZE emt_messages');
}

function explaining(client: Querying, examined: (examination: Examination) => void): Query {
  return async (text, values) => {
    if (text.includes('AS examined')) {
      const { rows } = await client.query<{ readonly 'QUERY PLAN': readonly Explained[] }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`,
        [...values],
      );
      const [plan] = rows[0]?.['QUERY PLAN'] ?? [];
      examined({
        milliseconds: plan?.['Run Time'] ?? 0,
        buffers: (plan?.Plan['Shared Hit Blocks'] ?? 0) + (plan?.Plan['Shared Read Blocks'] ?? 0),
      });
    }
    const { rows } = await client.query<Readonly<Record<string, unknown>>>(text, [...values]);
    return rows;
  };
}

async function measured(client: Querying, [label, page]: readonly [string, StoredPageRequest]): Promise<void> {
  const examinations: Examination[] = [];
  const store = postgresqlRecordedStore(
    explaining(client, (examination) => {
      examinations.push(examination);
    }),
  );
  await inTurn(times(warmReads + measuredReads), () => store.readRecorded(playbookKey, { kind: 'everything' }, page));
  const kept = examinations.slice(warmReads);
  const milliseconds = median(kept.map((examination) => examination.milliseconds)).toFixed(2);
  write(`${label}: ${milliseconds} ms at the median, ${median(kept.map(({ buffers }) => buffers))} buffers`);
}

if (postgresqlServer === '') {
  write('LEDGER_MEASURE_POSTGRESQL_URL names no server; nothing was measured');
} else {
  const administration = new Client({ connectionString: postgresqlServer });
  await administration.connect();
  const name = `ledger_measure_heads_${Date.now()}`;
  await administration.query(`CREATE DATABASE ${name}`);
  const url = new URL(postgresqlServer);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.href });
  await client.connect();
  await filled(client, url.href);
  write(`PostgreSQL, ${records} records of ${recordBytes} bytes in one playbook, the statement that examines a page:`);
  await inTurn(cases, (each) => measured(client, each));
  await client.end();
  await administration.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await administration.end();
}
