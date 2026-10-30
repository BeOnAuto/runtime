import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { deliverySweeps } from '../follower/consumers.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { StartRefused, type ReactionStart } from './reaction-options.ts';
import { refusalsOn } from './refusals.ts';
import { mostDeferredStarts, mostStartsAMinute, startingOn } from './start-rates.ts';
import { StartRejected } from './start-rejected.ts';

const playbookKey = 'playbook/acme/alpha/';

const minute = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

const CountRow = Schema.Struct({ count: WholeNumber });

function startNumber(index: number): ReactionStart {
  return {
    org: 'acme',
    playbook: 'alpha',
    workflow: 'close',
    version: 1,
    runId: `run-${index}`,
    input: [],
    depth: 1,
    cause: `record-${index}`,
    trigger: { kind: 'event', reference: '/schedule/on' },
  };
}

async function startingAt(time: Readonly<{ now: number }>, refuses = () => false) {
  const database = await openedOn(await onSQLite());
  const started: string[] = [];
  const refusals = refusalsOn(database, () => time.now);
  const starting = startingOn(
    database,
    (start) =>
      refuses()
        ? Effect.fail(new StartRefused({ detail: 'refused' }))
        : Effect.sync(() => {
            started.push(start.runId);
          }),
    refusals,
    () => time.now,
  );
  return { database, started, starting, refusals };
}

function startsOf(starting: Awaited<ReturnType<typeof startingAt>>['starting'], count: number) {
  return Effect.runPromise(
    Effect.forEach(
      Array.from({ length: count }, (_, index) => index),
      (index) => starting.start(playbookKey, startNumber(index)),
      { discard: true },
    ),
  );
}

async function deferredCount(database: HostDatabase) {
  const [row] = await Effect.runPromise(
    rowsOf(CountRow, database.read(statement`SELECT count(*) AS count FROM workflow_reaction_backlog`)),
  );
  return row?.count;
}

describe('the starts a reaction makes', () => {
  it('are 60 a minute for a workflow: the rest wait for a later minute, and start then', async () => {
    const time = { now: minute + 1000 };
    const { started, starting } = await startingAt(time);

    await startsOf(starting, mostStartsAMinute + 2);
    const thisMinute = started.length;
    time.now = minute + aMinute;
    const takenUp = await Effect.runPromise(starting.startDeferred());

    expect([thisMinute, takenUp, started.slice(-2)]).toEqual([mostStartsAMinute, 2, ['run-60', 'run-61']]);
  });

  it('wait again when the minute they were due in is full of starts of its own', async () => {
    const time = { now: minute + 1000 };
    const { started, starting } = await startingAt(time);
    await startsOf(starting, mostStartsAMinute + 1);
    time.now = minute + aMinute;
    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: mostStartsAMinute }, (_, index) => 1000 + index),
        (index) => starting.start(playbookKey, startNumber(index)),
        { discard: true },
      ),
    );

    await Effect.runPromise(starting.startDeferred());
    const whenFull = started.length;
    time.now = minute + 2 * aMinute;
    await Effect.runPromise(starting.startDeferred());

    expect([whenFull, started.at(-1)]).toEqual([2 * mostStartsAMinute, 'run-60']);
  });
});

describe('the starts that wait for a later minute', () => {
  it('are 1,000 at most: one more is refused, which is said once the minute ends', async () => {
    const time = { now: minute + 1000 };
    const { database, starting, refusals } = await startingAt(time);

    await startsOf(starting, mostStartsAMinute + 1);
    await Effect.runPromise(
      database.write(
        statement`WITH RECURSIVE waiting (at) AS (
            SELECT 1 UNION ALL SELECT at + 1 FROM waiting WHERE at < ${mostDeferredStarts - 1}
          )
          INSERT INTO workflow_reaction_backlog (playbook_key, workflow, run_id, start, due)
          SELECT ${playbookKey}, 'close', 'waiting-' || at, '{}', ${minute + aMinute} FROM waiting`,
      ),
    );

    await startsOf(starting, 2);
    const deferred = await deferredCount(database);
    time.now = minute + aMinute;
    await Effect.runPromise(refusals.flush());
    const { messages } = await database.store.read(`${playbookKey}reactions/close`);

    expect([deferred, messages]).toMatchObject([
      mostDeferredStarts,
      [
        {
          type: 'reaction_refused',
          data: {
            count: 2,
            reason:
              'The workflow was started by its event trigger 60 times a minute and 1000 starts already waited for a later minute, the most it keeps; this start was refused',
            minute: '2026-10-01T09:00:00.000Z',
          },
          context: { definitionName: 'close' },
        },
      ],
    ]);
  });
});

describe('a start the playbook refuses', () => {
  it('fails, so that its delivery is tried again, and a deferred one is kept for the next minute', async () => {
    const time = { now: minute + 1000 };
    const refusing = { now: false };
    const { started, starting } = await startingAt(time, () => refusing.now);
    await startsOf(starting, mostStartsAMinute + 1);
    refusing.now = true;
    time.now = minute + aMinute;

    const tried = await Effect.runPromise(starting.startDeferred());
    const failure = await Effect.runPromise(Effect.flip(starting.start(playbookKey, startNumber(99))));
    refusing.now = false;
    time.now = minute + 2 * aMinute;
    const again = await Effect.runPromise(starting.startDeferred());

    expect([tried, failure.detail, again, started.at(-1)]).toEqual([1, 'refused', 1, 'run-60']);
  });

  it('when deferred, is tried in 20 minutes and then dropped, which is said', async () => {
    const time = { now: minute + 1000 };
    const { database, starting, refusals } = await startingAt(time, () => time.now >= minute + aMinute);
    await startsOf(starting, mostStartsAMinute + 1);

    await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: deliverySweeps }, (_, index) => index + 1),
        (later) =>
          Effect.suspend(() => {
            time.now = minute + later * aMinute;
            return starting.startDeferred();
          }),
        { discard: true },
      ),
    );
    const left = await deferredCount(database);
    time.now = minute + (deliverySweeps + 1) * aMinute;
    await Effect.runPromise(refusals.flush());
    const { messages } = await database.store.read(`${playbookKey}reactions/close`);

    expect([left, messages]).toMatchObject([
      0,
      [
        {
          type: 'reaction_refused',
          data: { reason: 'The workflow could not be started by its event trigger: refused' },
        },
      ],
    ]);
  });
});

describe('a start the playbook rejects for good', () => {
  it('is said and not tried again, whether it starts at once or waited for a later minute', async () => {
    const time = { now: minute + 1000 };
    const database = await openedOn(await onSQLite());
    const refusals = refusalsOn(database, () => time.now);
    const rejecting = startingOn(
      database,
      () => Effect.fail(new StartRejected({ detail: 'The input is not what the workflow takes' })),
      refusals,
      () => time.now,
    );

    await startsOf(rejecting, mostStartsAMinute + 1);
    time.now = minute + aMinute;
    await Effect.runPromise(rejecting.startDeferred());
    const left = await deferredCount(database);
    time.now = minute + 2 * aMinute;
    await Effect.runPromise(refusals.flush());
    const { messages } = await database.store.read(`${playbookKey}reactions/close`);

    expect([left, messages]).toMatchObject([
      0,
      [
        {
          data: {
            count: mostStartsAMinute,
            reason: 'The workflow could not be started by its event trigger: The input is not what the workflow takes',
          },
        },
        { data: { count: 1 } },
      ],
    ]);
  });
});
