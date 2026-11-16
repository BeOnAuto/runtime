import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { DumboError, JSONSerializer, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { describe, expect, it, onTestFinished } from 'vitest';

import { settled } from '../testing/clients.ts';
import { aDatabaseFile, aTemporaryFolder } from '../testing/temporary-files.ts';
import { nodeSqlitePool, type NodeSqlitePoolOptions } from './node-sqlite-pool.ts';
import type { NodeSqlitePool } from './writer-pool.ts';
import { notStartedInTime, tooManyWaiting, writerClosed } from './writer-queue.ts';

const asEmmettOpensIt = { transactionOptions: { allowNestedTransactions: true } };

interface Answered {
  readonly rows: readonly unknown[];
}

async function aPool(options: NodeSqlitePoolOptions): Promise<NodeSqlitePool> {
  const pool = nodeSqlitePool({ ...asEmmettOpensIt, ...options });
  onTestFinished(() => pool.close());
  await pool.execute.command(SQL`CREATE TABLE IF NOT EXISTS notes (note TEXT)`);
  return pool;
}

function aPoolOnAFile(): Promise<NodeSqlitePool> {
  return aPool({ fileName: aDatabaseFile() });
}

async function notesIn(execute: SQLExecutor): Promise<readonly unknown[]> {
  return (await execute.query(SQL`SELECT note FROM notes ORDER BY note`)).rows;
}

interface HeldTransaction {
  readonly inside: Promise<SQLExecutor>;
  readonly letGo: () => Promise<void>;
}

function aTransactionHeldOpen(pool: Readonly<NodeSqlitePool>): HeldTransaction {
  const inside = Promise.withResolvers<SQLExecutor>();
  const letGo = Promise.withResolvers<void>();
  const held = pool.withTransaction(async ({ execute }) => {
    await execute.command(SQL`INSERT INTO notes VALUES ('uncommitted')`);
    inside.resolve(execute);
    await letGo.promise;
  });
  return {
    inside: inside.promise,
    letGo: async () => {
      letGo.resolve();
      await held;
    },
  };
}

describe('a pool of node:sqlite on a file, as it reads', () => {
  it('reads the committed snapshot outside a transaction while the one writer holds one open', async () => {
    const pool = await aPoolOnAFile();
    const held = aTransactionHeldOpen(pool);
    const inside = await held.inside;

    const [outside, within] = [await notesIn(pool.execute), await notesIn(inside)];
    await held.letGo();

    expect([outside, within, await notesIn(pool.execute)]).toEqual([
      [],
      [{ note: 'uncommitted' }],
      [{ note: 'uncommitted' }],
    ]);
  });

  it('runs a statement issued inside a transaction’s async context on that transaction’s connection', async () => {
    const pool = await aPoolOnAFile();

    const seen = await pool.withTransaction(async () => {
      await pool.execute.command(SQL`INSERT INTO notes VALUES ('within')`);
      await pool.execute.batchCommand([SQL`INSERT INTO notes VALUES ('batched')`]);
      return {
        queried: await notesIn(pool.execute),
        batched: (await pool.execute.batchQuery([SQL`SELECT count(*) AS notes FROM notes`])).map(
          (answer: Answered) => answer.rows,
        ),
        nested: await pool.withTransaction(({ execute }) => notesIn(execute)),
        connected: await pool.withConnection(({ execute }) => notesIn(execute), { readonly: true }),
      };
    });

    const within = [{ note: 'batched' }, { note: 'within' }];
    expect(seen).toEqual({ queried: within, batched: [[{ notes: 2 }]], nested: within, connected: within });
  });
});

describe('the connections a pool of node:sqlite on a file hands out', () => {
  it('hands a reader for a read-only connection outside a transaction, and the writer otherwise', async () => {
    const pool = await aPoolOnAFile();
    const held = aTransactionHeldOpen(pool);
    await held.inside;

    const reader = await pool.connection({ readonly: true });
    const read = await notesIn(reader.execute);
    await reader.close();
    const readOnly = await pool.withConnection(({ execute }) => notesIn(execute), { readonly: true });
    await held.letGo();
    const writer = await pool.connection();
    const written = await writer.execute.command(SQL`INSERT INTO notes VALUES ('by the writer')`);

    expect([read, readOnly, written]).toEqual([[], [], { rowCount: 1, rows: [] }]);
  });
});

describe('a pool of node:sqlite on a file, as it writes', () => {
  it('lets one writer at a time write, each waiting its turn, in the async context of its caller', async () => {
    const pool = await aPoolOnAFile();
    const context = new AsyncLocalStorage<string>();
    const held = aTransactionHeldOpen(pool);
    await held.inside;

    const queued = context.run('the caller', () =>
      pool.withTransaction(async ({ execute }) => {
        await execute.command(SQL`INSERT INTO notes VALUES ('queued')`);
        return context.getStore();
      }),
    );
    const commanded = pool.execute.command(SQL`INSERT INTO notes VALUES ('commanded')`);
    await held.letGo();

    expect([await queued, await commanded]).toEqual(['the caller', { rowCount: 1, rows: [] }]);
    expect(await notesIn(pool.execute)).toEqual([{ note: 'commanded' }, { note: 'queued' }, { note: 'uncommitted' }]);
  });

  it('runs a transaction a connection of the writer begins in that connection’s async context', async () => {
    const pool = await aPoolOnAFile();

    const seen = await pool.withConnection((connection) =>
      connection.withTransaction(async () => {
        await pool.execute.command(SQL`INSERT INTO notes VALUES ('on the writer')`);
        return notesIn(pool.execute);
      }),
    );

    expect(seen).toEqual([{ note: 'on the writer' }]);
  });

  it('begins a transaction it hands out on the writer', async () => {
    const pool = await aPoolOnAFile();
    const transaction = pool.transaction();

    await transaction.begin();
    await transaction.execute.command(SQL`INSERT INTO notes VALUES ('handed out')`);
    await transaction.commit();

    expect(await notesIn(pool.execute)).toEqual([{ note: 'handed out' }]);
  });
});

describe('the bounds of the one writer of a pool of node:sqlite', () => {
  it('refuse a write that did not start within the longest wait, in today’s words', async () => {
    const pool = await aPool({ fileName: aDatabaseFile(), maxTaskIdleTime: 20 });
    const held = aTransactionHeldOpen(pool);
    await held.inside;

    const refusal = await settled(pool.execute.command(SQL`INSERT INTO notes VALUES ('late')`));
    await held.letGo();

    expect(refusal).toEqual({ status: 'rejected', reason: new DumboError(notStartedInTime) });
  });

  it('refuse a write once a thousand wait for the writer, in today’s words', async () => {
    const pool = await aPoolOnAFile();
    const held = aTransactionHeldOpen(pool);
    await held.inside;
    const waiting = Array.from({ length: 1000 }, (_, place) =>
      pool.execute.batchCommand([SQL`INSERT INTO notes VALUES (${`waiting ${place}`})`]),
    );

    const refusal = await settled(pool.execute.command(SQL`INSERT INTO notes VALUES ('one too many')`));
    await held.letGo();
    await Promise.all(waiting);

    expect(refusal).toEqual({ status: 'rejected', reason: new DumboError(tooManyWaiting) });
    expect((await pool.execute.query(SQL`SELECT count(*) AS notes FROM notes`)).rows).toEqual([{ notes: 1001 }]);
  });
});

describe('the file of a pool of node:sqlite', () => {
  it('is prepared once, in WAL, however many connections open it at once', async () => {
    const pool = nodeSqlitePool({ fileName: aDatabaseFile(), readerPoolSize: 2 });
    onTestFinished(() => pool.close());

    const modes = await Promise.all(Array.from({ length: 4 }, () => pool.execute.query(SQL`PRAGMA journal_mode`)));

    expect(modes.map((answer: Answered) => answer.rows)).toEqual(
      Array.from({ length: 4 }, () => [{ journal_mode: 'wal' }]),
    );
  });

  it('is prepared again on the next use when its first preparation failed', async () => {
    const folder = join(aTemporaryFolder(), 'made later');
    const pool = nodeSqlitePool({ fileName: join(folder, 'database.db'), serializer: JSONSerializer });
    onTestFinished(() => pool.close());

    const refusal = await settled(pool.execute.query(SQL`SELECT 1 AS one`));
    mkdirSync(folder);

    expect(refusal).toMatchObject({
      status: 'rejected',
      reason: { message: 'SQLITE_CANTOPEN: unable to open database file' },
    });
    expect((await pool.execute.query(SQL`SELECT 1 AS one`)).rows).toEqual([{ one: 1 }]);
  });

  it('is refused for reads and writes once its pool is closed, in the words of each pool', async () => {
    const pool = await aPoolOnAFile();
    await pool.close();

    const refusals = [
      await settled(pool.execute.query(SQL`SELECT 1`)),
      await settled(pool.execute.command(SQL`SELECT 1`)),
    ];

    expect(refusals).toMatchObject([
      { status: 'rejected', reason: { message: 'Bounded connection pool has been closed' } },
      { status: 'rejected', reason: { message: writerClosed } },
    ]);
  });
});

describe('a pool of node:sqlite in memory', () => {
  it('keeps one connection, which reads what a transaction open on it wrote, as the add-on’s did', async () => {
    const pool = await aPool({ fileName: ':memory:' });
    const held = aTransactionHeldOpen(pool);
    await held.inside;

    const [readAlongside, readOnly] = [
      await notesIn(pool.execute),
      await pool.withConnection(({ execute }) => notesIn(execute), { readonly: true }),
    ];
    await held.letGo();

    expect([readAlongside, readOnly]).toEqual([[{ note: 'uncommitted' }], [{ note: 'uncommitted' }]]);
  });

  it('opens in memory when it is given no file', async () => {
    const pool = await aPool({});
    await pool.execute.command(SQL`INSERT INTO notes VALUES ('remembered')`);

    expect(await notesIn(pool.execute)).toEqual([{ note: 'remembered' }]);
  });

  it('refuses reads once it is closed, in the words of the library’s singleton pool', async () => {
    const pool = await aPool({ fileName: ':memory:' });
    await pool.close();

    expect(await settled(pool.execute.query(SQL`SELECT 1`))).toMatchObject({
      status: 'rejected',
      reason: { message: 'Singleton connection pool has been closed' },
    });
  });
});
