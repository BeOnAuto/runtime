import { setTimeout as sleep } from 'node:timers/promises';

import { SQL } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import { aConnectedClient, rowsOf, settled } from '../testing/clients.ts';
import { aDatabaseFile } from '../testing/temporary-files.ts';
import { busyDelay, waitedForTheLock, type LockWait } from './busy-handler.ts';
import type { NodeSqliteClient } from './node-sqlite-client.ts';

const theDelaysOfSQLitesDefaultBusyHandler = [1, 2, 5, 10, 15, 20, 25, 25, 25, 50, 50, 100, 100, 100];

const outsideATransaction: LockWait = { busyTimeout: 5000, inATransaction: () => false };

function aBusyFailure(): Error {
  return Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
}

interface Attempts {
  readonly attempt: () => Promise<string>;
  readonly made: () => number;
}

function failingFirst(failures: readonly Readonly<Error>[]): Attempts {
  const counted = { made: 0 };
  return {
    attempt: () => {
      const failure = failures[counted.made];
      counted.made += 1;
      return failure === undefined ? Promise.resolve('answered') : Promise.reject(failure);
    },
    made: () => counted.made,
  };
}

describe('the delay before a busy statement is tried again', () => {
  it('follows the delays of SQLite’s default busy handler, the last repeated', () => {
    expect(theDelaysOfSQLitesDefaultBusyHandler.map((_, attempt) => busyDelay(attempt, 5000))).toEqual(
      theDelaysOfSQLitesDefaultBusyHandler,
    );
  });

  it('is cut short at the busy timeout, and is nothing once it has passed, as SQLite’s is', () => {
    expect([busyDelay(3, 10), busyDelay(4, 10), busyDelay(0, 0), busyDelay(12, 400), busyDelay(13, 400)]).toEqual([
      2, -8, 0, 72, -28,
    ]);
  });
});

describe('a statement that finds its file busy', () => {
  it('is tried again outside a transaction until it is answered', async () => {
    const statement = failingFirst([aBusyFailure(), aBusyFailure(), aBusyFailure()]);

    expect(await waitedForTheLock(statement.attempt, outsideATransaction)).toBe('answered');
    expect(statement.made()).toBe(4);
  });

  it('fails with SQLite’s busy error once the busy timeout has passed, after as many attempts as SQLite makes', async () => {
    const busy = aBusyFailure();
    const statement = failingFirst(Array.from({ length: 10 }, () => busy));
    const began = performance.now();

    const outcome = await settled(waitedForTheLock(statement.attempt, { ...outsideATransaction, busyTimeout: 20 }));

    expect(outcome).toEqual({ status: 'rejected', reason: busy });
    expect(performance.now() - began).toBeGreaterThanOrEqual(19);
    expect(statement.made()).toBe(6);
  });

  it.each([
    ['inside a transaction, where SQLite says to roll back instead', { inATransaction: () => true }, aBusyFailure()],
    ['when its busy timeout is nothing', { busyTimeout: 0 }, aBusyFailure()],
    [
      'for a failure other than a busy file',
      {},
      Object.assign(new Error('database table is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 6 }),
    ],
  ])('is not tried again %s', async (_named: string, wait: Partial<LockWait>, failure: Readonly<Error>) => {
    const statement = failingFirst([failure]);

    expect(await settled(waitedForTheLock(statement.attempt, { ...outsideATransaction, ...wait }))).toEqual({
      status: 'rejected',
      reason: failure,
    });
    expect(statement.made()).toBe(1);
  });
});

async function twoClientsOnOneFile(): Promise<readonly [NodeSqliteClient, NodeSqliteClient]> {
  const fileName = aDatabaseFile();
  const waitingLittle = { fileName, pragmaOptions: { busy_timeout: 100 } };
  const holder = await aConnectedClient(waitingLittle);
  await holder.command(SQL`CREATE TABLE notes (note TEXT)`);
  return [holder, await aConnectedClient(waitingLittle)];
}

describe('a client of node:sqlite whose file another connection holds', () => {
  it('waits for the lock without holding the event loop, and writes once the holder lets go', async () => {
    const [holder, waiting] = await twoClientsOnOneFile();
    await holder.command(SQL`BEGIN IMMEDIATE`);
    const ticks: number[] = [];
    const ticking = setInterval(() => {
      ticks.push(performance.now());
    }, 1);

    const written = waiting.command(SQL`INSERT INTO notes VALUES ('waited')`);
    await sleep(40);
    await holder.command(SQL`COMMIT`);
    const answer = await written;
    clearInterval(ticking);

    expect(answer).toEqual({ rowCount: 1, rows: [] });
    expect(ticks.length).toBeGreaterThan(1);
    expect(await rowsOf(holder, 'SELECT note FROM notes')).toEqual([{ note: 'waited' }]);
  });

  it('fails with SQLITE_BUSY once its busy timeout has passed, as the add-on did', async () => {
    const [holder, waiting] = await twoClientsOnOneFile();
    await holder.command(SQL`BEGIN IMMEDIATE`);
    const began = performance.now();

    const refusal = await settled(waiting.command(SQL`INSERT INTO notes VALUES ('refused')`));

    expect(performance.now() - began).toBeGreaterThanOrEqual(99);
    expect(refusal).toMatchObject({
      status: 'rejected',
      reason: { errorType: 'LockNotAvailableError', message: 'SQLITE_BUSY: database is locked' },
    });
    await holder.command(SQL`ROLLBACK`);
  });

  it('fails at once inside a transaction of its own, where SQLite says to roll back rather than wait', async () => {
    const [holder, waiting] = await twoClientsOnOneFile();
    await waiting.command(SQL`BEGIN DEFERRED`);
    await rowsOf(waiting, 'SELECT count(*) FROM notes');
    await holder.command(SQL`INSERT INTO notes VALUES ('moved on')`);
    const began = performance.now();

    const refusal = await settled(waiting.command(SQL`INSERT INTO notes VALUES ('stale')`));

    expect(performance.now() - began).toBeLessThan(50);
    expect(refusal).toMatchObject({ status: 'rejected', reason: { errorType: 'LockNotAvailableError' } });
    await waiting.command(SQL`ROLLBACK`);
  });
});

async function aReadHeldOpen(reader: NodeSqliteClient): Promise<readonly unknown[]> {
  await reader.command(SQL`BEGIN DEFERRED`);
  return rowsOf(reader, 'SELECT count(*) AS notes FROM notes');
}

describe('a COMMIT of a client of node:sqlite on a file in WAL', () => {
  it('is answered while another connection holds a read of the same file open, since in WAL a reader does not block the writer', async () => {
    const [writer, reader] = await twoClientsOnOneFile();
    const before = await aReadHeldOpen(reader);
    await writer.command(SQL`BEGIN IMMEDIATE`);
    await writer.command(SQL`INSERT INTO notes VALUES ('committed')`);

    const committed = await settled(writer.command(SQL`COMMIT`));

    expect(committed).toMatchObject({ status: 'fulfilled' });
    expect([before, await rowsOf(reader, 'SELECT count(*) AS notes FROM notes')]).toEqual([
      [{ notes: 0 }],
      [{ notes: 0 }],
    ]);
    await reader.command(SQL`COMMIT`);
    expect(await rowsOf(reader, 'SELECT count(*) AS notes FROM notes')).toEqual([{ notes: 1 }]);
  });

  it('is answered past the checkpoint SQLite runs by itself at 1,000 pages while a reader holds the log, which SQLite runs passive and does not wait for', async () => {
    const [writer, reader] = await twoClientsOnOneFile();
    await aReadHeldOpen(reader);
    await writer.command(SQL`BEGIN IMMEDIATE`);
    await writer.command(
      SQL`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1500) INSERT INTO notes SELECT hex(randomblob(4096)) FROM n`,
    );

    const committed = await settled(writer.command(SQL`COMMIT`));

    expect(committed).toMatchObject({ status: 'fulfilled' });
    expect(await rowsOf(writer, 'SELECT count(*) AS notes FROM notes')).toEqual([{ notes: 1500 }]);
    await reader.command(SQL`COMMIT`);
  });

  it('meets another writer at BEGIN IMMEDIATE, never at its COMMIT, since the write lock is taken as the transaction begins', async () => {
    const [writer, other] = await twoClientsOnOneFile();
    await writer.command(SQL`BEGIN IMMEDIATE`);
    await writer.command(SQL`INSERT INTO notes VALUES ('first')`);

    const refused = await settled(other.command(SQL`BEGIN IMMEDIATE`));
    const committed = await settled(writer.command(SQL`COMMIT`));

    expect([refused, committed]).toMatchObject([
      {
        status: 'rejected',
        reason: { errorType: 'LockNotAvailableError', message: 'SQLITE_BUSY: database is locked' },
      },
      { status: 'fulfilled' },
    ]);
  });
});
