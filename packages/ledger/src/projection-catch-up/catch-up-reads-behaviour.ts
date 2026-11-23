import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import {
  labelFacts,
  labelRows,
  labelRowsByNote,
  runFacts,
  runTallyRows,
  topicFacts,
  topicRows,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { InTransaction, StatementExecutor } from '../event-store.ts';
import type { InlineRegistration } from '../projections/inline-projection.ts';
import {
  aLargeStart,
  aLedgerOn,
  bytesOfALargeFact,
  filledMeasured,
  heldOf,
  indexes,
  notedLarge,
  type FillEntry,
} from '../projections/keyed-fill-behaviour.ts';
import { readsAsTheyCome } from '../projections/projection-reads.ts';
import { openChoresWith } from '../testing/open-ledger.ts';

type AnyLedger = Awaited<ReturnType<typeof aLedgerOn>>;

const autumnOpened: TopicFact = { type: 'topic_opened', data: { topic: 'autumn', at: 1000 } };

function notedOfSizes(ledger: AnyLedger, sizes: readonly number[]): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      [autumnOpened, ...sizes.map((bytes, index) => aNoteOf(bytes, index))],
      (fact, index) => ledger.execute(`playbook/acme/alpha/notes/s${index}`, topicFacts, [fact]),
      { discard: true },
    ),
  );
}

function aNoteOf(bytes: number, index: number): TopicFact {
  return { type: 'topic_noted', data: { topic: 'autumn', note: `${index}:${'n'.repeat(bytes)}` } };
}

function labelledTwiceOver(ledger: AnyLedger): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      indexes(4),
      (index) =>
        Effect.andThen(
          ledger.execute(`playbook/acme/alpha/notes/l${index}`, labelFacts, [
            { type: 'labels_set', data: { note: `l${index}`, labels: ['urgent'] } },
          ]),
          ledger.execute(`playbook/acme/alpha/runs/r${index}`, runFacts, [aLargeStart(index)]),
        ),
      { discard: true },
    ),
  );
}

function windowsAndReads(entry: FillEntry): void {
  it('lists one fact, then twice as many after each window, as many as fit its bound at the sizes it saw', async () => {
    const database = await entry.aDatabase();
    await notedOfSizes(
      await aLedgerOn(entry, database),
      indexes(299).map(() => 8),
    );

    const { windows } = await filledMeasured(entry, database, { projections: [topicRows] });

    expect(windows).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 45]);
  });

  it('reads the data of each fact once, however many of the tables it fills fold it', async () => {
    const database = await entry.aDatabase();
    await labelledTwiceOver(await aLedgerOn(entry, database));

    const { points } = await filledMeasured(entry, database, {
      projections: [labelRows, labelRowsByNote, runTallyRows],
    });

    expect([points.length, new Set(points).size]).toEqual([8, 8]);
  });
}

function theBoundsOfARead(entry: FillEntry): void {
  it('reads a fact larger than its bound alone, and the facts around it within the bound', async () => {
    const database = await entry.aDatabase();
    await notedOfSizes(await aLedgerOn(entry, database), [8, 8, 8, 8, bytesOfALargeFact, 8, 8, 8, 8]);

    const { loads, facts } = await filledMeasured(entry, database, {
      projections: [topicRows],
      mostBytesFilledAtOnce: 1024,
    });
    const next = await aLedgerOn(entry, database, { projections: [topicRows] });

    const largest = Math.max(...loads);
    expect([largest > 1024, facts[loads.indexOf(largest)]]).toEqual([true, 1]);
    expect(loads.toSorted((left, right) => right - left)[1]).toBeLessThanOrEqual(1024);
    expect(await heldOf(next, 'topics', 'note')).toEqual(['8']);
  });

  it('reads no fact as a store opens whose tables are all caught up', async () => {
    const database = await entry.aDatabase();
    await notedLarge(await aLedgerOn(entry, database, { projections: [topicRows, runTallyRows] }), 3);

    const { points, windows } = await filledMeasured(entry, database, { projections: [topicRows, runTallyRows] });

    expect([points, windows]).toEqual([[], []]);
  });
}

interface Handling {
  readonly projection: Pick<InlineRegistration['projection'], 'handle'>;
}

interface Recorded {
  readonly statements: readonly string[];
  readonly execute: StatementExecutor;
}

function recordedOn(execute: StatementExecutor): Recorded {
  const statements: string[] = [];
  const recorded = (sql: SQL) => {
    statements.push(SQL.describe(sql, sqliteFormatter));
    return sql;
  };
  return {
    statements,
    execute: {
      query: (sql) => execute.query(recorded(sql)),
      command: (sql) => execute.command(recorded(sql)),
    },
  };
}

const alpha = { org: 'acme', playbook: 'alpha' };

function appendedNote(dialect: ReturnType<FillEntry['projectionsOf']>['dialect']) {
  return {
    type: 'topic_noted',
    data: dialect.storedData({ topic: 'autumn', note: 'later' }),
    metadata: {
      streamName: 'playbook/acme/alpha/notes/n9',
      messageId: 'n9',
      streamPosition: 1,
      at: '2026-10-05T09:00:00.000Z',
      by: 'topics',
    },
  };
}

function appendedAndRead(entry: FillEntry, execute: StatementExecutor): Promise<readonly string[]> {
  const parts = entry.projectionsOf({ projections: [topicRows] });
  const recorded = recordedOn(execute);
  const inTransaction: InTransaction = (work) => work(recorded.execute);
  const query = async (sql: SQL) => (await recorded.execute.query(sql)).rows;
  const reader = parts.readerOn({
    query,
    command: (sql) => recorded.execute.command(sql),
    inTransaction,
    consistently: readsAsTheyCome(query),
  });
  const appended = { execute: recorded.execute };
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.promise(() => parts.prepare(recorded.execute, inTransaction));
      yield* Effect.promise(() => parts.caughtUp(inTransaction));
      const opened = recorded.statements.length;
      yield* Effect.promise(() =>
        Promise.all(
          parts.registrations.map(({ projection }: Handling) =>
            projection.handle([appendedNote(parts.dialect)], appended),
          ),
        ),
      );
      yield* reader.readProjectedRows('topics', alpha, { where: [], orderBy: [], order: 'asc', limit: 10 });
      yield* reader.countProjectedRows('topics', alpha, []);
      yield* reader.readDueRows('topics', { column: 'due_at', through: 10_000, limit: 10 });
      yield* reader.nextDueOf('topics', 'due_at', 0);
      yield* reader.advanceRow('topics', alpha, 'autumn', { set: { open: false }, when: [] });
      return recorded.statements.slice(opened);
    }),
  );
}

function noBudget(entry: FillEntry): void {
  it('folds an append and serves the five reads with statements on their own table alone, where the store was given no budget', async () => {
    const database = await entry.aDatabase();
    await notedLarge(await aLedgerOn(entry, database, { projections: [topicRows] }), 1);

    const statements = await entry.executedOn(database, (execute) => appendedAndRead(entry, execute));

    expect([statements.length > 0, statements.every((statement) => statement.includes('topics_2'))]).toEqual([
      true,
      true,
    ]);
  });
}

const theReadRefused = new Error('The read of the positions was refused');

function refusingThePositions(execute: StatementExecutor): StatementExecutor {
  return {
    query: (sql) =>
      SQL.describe(sql, sqliteFormatter).includes('folded_through IS NOT NULL')
        ? Promise.reject(theReadRefused)
        : execute.query(sql),
    command: (sql) => execute.command(sql),
  };
}

function aFailureNoPageLogs(entry: FillEntry): void {
  it('fails a catch-up given a budget where the read of its positions fails, a failure no page logs, as a catch-up given none fails', async () => {
    const database = await entry.aDatabase();
    await notedLarge(await aLedgerOn(entry, database), 1);

    await entry.executedOn(database, async (execute) => {
      const refusing = refusingThePositions(execute);
      const parts = entry.projectionsOf({ projections: [topicRows], catchUpBudget: { pages: 1 } });
      await parts.prepare(refusing, (work) => work(refusing));

      await expect(parts.caughtUp((work) => work(refusing))).rejects.toBe(theReadRefused);
    });
  });
}

function aSliceOfTheChore(entry: FillEntry): void {
  it('answers caught up from a slice of the chore and from its state once the opening has caught every table up', async () => {
    const database = await entry.aDatabase();
    const { catchUpSlice, catchUpState, dispose } = await openChoresWith(
      entry.ledgerOn(database, { projections: [topicRows] }),
    );
    onTestFinished(dispose);

    expect([await catchUpState(), await catchUpSlice()]).toEqual(['caught_up', 'caught_up']);
  });
}

export function catchUpReadsBehaviour(entry: FillEntry): void {
  describe('the catch-up of the keyed tables, in pages of a window of the store each', () => {
    windowsAndReads(entry);
    theBoundsOfARead(entry);
    noBudget(entry);
    aFailureNoPageLogs(entry);
    aSliceOfTheChore(entry);
  });
}
