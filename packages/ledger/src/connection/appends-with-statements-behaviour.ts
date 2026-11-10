import { Effect, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { eventAppenderWithOf } from '../event-appender.ts';
import type { OpenedLedger } from '../ledger-layer.ts';
import { stamped } from '../testing/happenings.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { tally } from '../testing/tally.ts';
import { isVersionConflict, VersionConflict } from '../version-conflict.ts';
import { StatementsFailed } from './appends-with.ts';
import { statement } from './statement.ts';

const counts = 'org/acme/counts';

const besideTable = statement`CREATE TABLE IF NOT EXISTS ends_beside (stream TEXT NOT NULL PRIMARY KEY, version INTEGER NOT NULL)`;

const besideRead = statement`SELECT stream, version FROM ends_beside ORDER BY stream`;

const counted = (n: number) => ({ type: 'counted', data: { n } });

function endedAt(stream: string, version: number) {
  return statement`INSERT INTO ends_beside (stream, version) VALUES (${stream}, ${version})`;
}

async function openedWithATableBeside(entry: LedgerEntry): Promise<OpenedLedger> {
  const opened = entry.openedOn(await entry.aDatabase());
  onTestFinished(() => opened.store.close());
  await opened.store.migrate();
  await opened.connection.migrated([besideTable]);
  return opened;
}

async function versionOf({ store }: OpenedLedger): Promise<number> {
  return (await store.read(counts)).version;
}

function outcomeOf(appended: Promise<void>): Promise<unknown> {
  return appended.then(
    () => 'appended',
    (failure: unknown) => failure,
  );
}

function keptTogether(entry: LedgerEntry): void {
  it('runs them in the transaction of its events, once, so both are kept together', async () => {
    const opened = await openedWithATableBeside(entry);

    const appended = await outcomeOf(
      opened.connection.appendWith(counts, [counted(1), counted(2)], { expectedVersion: 0, context: stamped }, [
        endedAt(counts, 2),
      ]),
    );

    expect([appended, await versionOf(opened), await opened.connection.read(besideRead)]).toEqual([
      'appended',
      2,
      [{ stream: counts, version: 2 }],
    ]);
  });

  it('is an append alone when it carries no statement', async () => {
    const opened = await openedWithATableBeside(entry);

    await opened.connection.appendWith(counts, [counted(1)], { expectedVersion: 0, context: stamped }, []);

    expect([await versionOf(opened), await opened.connection.read(besideRead)]).toEqual([1, []]);
  });
}

function keptNeither(entry: LedgerEntry): void {
  it('runs none of them when its events meet a version conflict, which it fails with', async () => {
    const opened = await openedWithATableBeside(entry);
    await opened.store.append(counts, [counted(1)], { expectedVersion: 0, context: stamped });

    const conflict = await outcomeOf(
      opened.connection.appendWith(counts, [counted(2)], { expectedVersion: 0, context: stamped }, [
        endedAt(counts, 1),
      ]),
    );

    expect([isVersionConflict(conflict), await versionOf(opened), await opened.connection.read(besideRead)]).toEqual([
      true,
      1,
      [],
    ]);
  });

  it('keeps none of its events and none of its statements when one fails, failing as its statements failed, with the driver’s error as the cause', async () => {
    const opened = await openedWithATableBeside(entry);

    const failure = await outcomeOf(
      opened.connection.appendWith(counts, [counted(1)], { expectedVersion: 0, context: stamped }, [
        endedAt(counts, 1),
        statement`INSERT INTO nowhere VALUES (${1})`,
      ]),
    );

    expect([failure instanceof StatementsFailed, isVersionConflict(failure)]).toEqual([true, false]);
    expect(String(Reflect.get(new Object(failure), 'cause'))).toContain('nowhere');
    expect([await versionOf(opened), await opened.connection.read(besideRead)]).toEqual([0, []]);
  });

  it('fails as its statements failed, never as a version conflict, when one breaks a key, so the append is not decided again for ever', async () => {
    const opened = await openedWithATableBeside(entry);
    await opened.connection.write(endedAt(counts, 9));

    const failure = await outcomeOf(
      opened.connection.appendWith(counts, [counted(1)], { expectedVersion: 0, context: stamped }, [
        endedAt(counts, 1),
      ]),
    );

    expect([failure instanceof StatementsFailed, isVersionConflict(failure)]).toEqual([true, false]);
    expect([await versionOf(opened), await opened.connection.read(besideRead)]).toEqual([
      0,
      [{ stream: counts, version: 9 }],
    ]);
  });
}

function madeByTheAppender(entry: LedgerEntry): void {
  it('is made by the event appender of the connection, which encodes its events as every append does and fails a conflict as one', async () => {
    const opened = await openedWithATableBeside(entry);
    const append = eventAppenderWithOf(opened.connection, tally.eventSchema);
    const place = { expectedVersion: 0, context: stamped };

    await Effect.runPromise(append(counts, [{ type: 'counted', data: { by: 3 } }], place, [endedAt(counts, 1)]));
    const conflict = await Effect.runPromise(
      Effect.result(append(counts, [{ type: 'counted', data: { by: 4 } }], place, [endedAt(counts, 2)])),
    );

    const { messages } = await opened.store.read(counts);
    expect(messages.map(({ type, data }) => ({ type, data }))).toEqual([{ type: 'counted', data: { by: 3 } }]);
    expect([conflict, await opened.connection.read(besideRead)]).toEqual([
      Result.fail(new VersionConflict()),
      [{ stream: counts, version: 1 }],
    ]);
  });
}

export function appendsWithStatementsOnStoresBehaviour(entry: LedgerEntry): void {
  describe('an append that carries statements of the code beside the ledger', () => {
    keptTogether(entry);
    keptNeither(entry);
    madeByTheAppender(entry);
  });
}
