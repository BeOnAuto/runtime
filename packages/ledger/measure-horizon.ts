import { Client } from 'pg';

import {
  binding,
  oldestWriteOfThisDatabase,
  writesOpenElsewhere,
  type Query,
} from './src/postgresql-reads/recorded-parts.ts';

type Querying = Readonly<Pick<Client, 'query'>>;

type Horizon = () => Promise<bigint>;

interface Ways {
  readonly inside: Horizon;
  readonly first: Horizon;
}

interface Held {
  readonly inside: number;
  readonly first: number;
}

const postgresqlServer = process.env['LEDGER_MEASURE_POSTGRESQL_URL'] ?? '';

const readsEachWay = 3000;

const writersElsewhere = 8;

const writesTable =
  'CREATE TABLE measured_writes (id serial PRIMARY KEY, written xid8 NOT NULL DEFAULT pg_current_xact_id())';

const lookedUpInsideTheRead = `(
  SELECT coalesce(min(running.xid), pg_snapshot_xmax(pg_current_snapshot()))
  FROM pg_snapshot_xip(pg_current_snapshot()) AS running(xid)
  WHERE running.xid::text::bigint % 4294967296 NOT IN (
    SELECT backend_xid::text::bigint FROM pg_stat_activity
    WHERE backend_xid IS NOT NULL AND datname IS DISTINCT FROM current_database()
  )
)`;

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function connected(database: string): Promise<Client> {
  const url = new URL(postgresqlServer);
  url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.href });
  await client.connect();
  return client;
}

async function horizonOf(client: Querying, statement: string, values: readonly unknown[] = []): Promise<bigint> {
  const { rows } = await client.query<{ readonly horizon: string }>(statement, [...values]);
  return BigInt(rows[0]?.horizon ?? '0');
}

function insideTheRead(reader: Querying): Horizon {
  return () => horizonOf(reader, `SELECT ${lookedUpInsideTheRead}::text AS horizon`);
}

function firstOnItsOwn(reader: Querying): Horizon {
  const query: Query = async (text, values) => (await reader.query<Record<string, unknown>>(text, [...values])).rows;
  return async () => {
    const elsewhere = await writesOpenElsewhere(query);
    const { values, bind } = binding();
    return horizonOf(reader, `SELECT ${oldestWriteOfThisDatabase(bind, elsewhere)}::text AS horizon`, values);
  };
}

async function written(writer: Querying): Promise<bigint> {
  const { rows } = await writer.query<{ readonly id: string }>(
    'INSERT INTO measured_writes DEFAULT VALUES RETURNING written::text AS id',
  );
  return BigInt(rows[0]?.id ?? '0');
}

async function heldBack(writer: Querying, horizon: Horizon): Promise<number> {
  const id = await written(writer);
  return Number(id >= (await horizon()));
}

async function keptWriting(client: Querying, going: () => boolean): Promise<void> {
  if (!going()) {
    return;
  }
  await client.query('BEGIN');
  await client.query('INSERT INTO measured_writes DEFAULT VALUES');
  await client.query('SELECT pg_sleep(random() * 0.05)');
  await client.query('COMMIT');
  await keptWriting(client, going);
}

async function counted(writer: Querying, ways: Ways, left: number, held: Held): Promise<Held> {
  if (left === 0) {
    return held;
  }
  const inside = await heldBack(writer, ways.inside);
  const first = await heldBack(writer, ways.first);
  return counted(writer, ways, left - 1, { inside: held.inside + inside, first: held.first + first });
}

async function made(database: string): Promise<void> {
  const client = await connected(database);
  await client.query(writesTable);
  await client.end();
}

async function measured(ledger: string, elsewhere: string): Promise<void> {
  await made(ledger);
  await made(elsewhere);
  const writer = await connected(ledger);
  const reader = await connected(ledger);
  const others = await Promise.all(Array.from({ length: writersElsewhere }, () => connected(elsewhere)));
  const state = { going: true };
  const writing = others.map((client: Querying) => keptWriting(client, () => state.going));
  const ways = { inside: insideTheRead(reader), first: firstOnItsOwn(reader) };
  const { inside, first } = await counted(writer, ways, readsEachWay, { inside: 0, first: 0 });
  state.going = false;
  await Promise.all(writing);
  await Promise.all([writer, reader, ...others].map((client: Readonly<Pick<Client, 'end'>>) => client.end()));
  write(`| inside the read's own statement | ${inside} of ${readsEachWay} |`);
  write(`| in a statement of its own, before the read | ${first} of ${readsEachWay} |`);
}

if (postgresqlServer === '') {
  write('LEDGER_MEASURE_POSTGRESQL_URL names no server; nothing was measured');
} else {
  const administration = new Client({ connectionString: postgresqlServer });
  await administration.connect();
  const ledger = `ledger_measure_horizon_${Date.now()}`;
  const elsewhere = `${ledger}_elsewhere`;
  await administration.query(`CREATE DATABASE ${ledger}`);
  await administration.query(`CREATE DATABASE ${elsewhere}`);
  write(
    `PostgreSQL, ${readsEachWay} reads each way, each right after a write of its database committed, while ${writersElsewhere} connections wrote in another database:`,
  );
  write(
    '| Where the read looks up the writes open in other databases | Reads that held back the write committed before them |',
  );
  write('| --- | --- |');
  await measured(ledger, elsewhere);
  await administration.query(`DROP DATABASE ${ledger} WITH (FORCE)`);
  await administration.query(`DROP DATABASE ${elsewhere} WITH (FORCE)`);
  await administration.end();
}
