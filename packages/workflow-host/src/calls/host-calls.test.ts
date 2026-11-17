import { statement, type Statement } from '@on.auto/ledger';
import { callKeyText, type CancelCall } from '@on.auto/workflow-engine';
import type { CallAnsweredResult, StartCall } from '@on.auto/workflow-engine';
import { Deferred, Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { cancelledCall } from './call-cancels.ts';
import { callRowOf } from './call-rows.ts';
import { hostExecutor } from './host-executor.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const cancelling: CancelCall = {
  kind: 'cancel_call',
  key: { runId: runKey, reference: '/do/0/ask', run: 1 },
  reason: 'deadline',
};

const key = callKeyText(cancelling.key);

function startedAfterItsFirstRead(database: HostDatabase): HostDatabase {
  const started = database.write(
    statement`INSERT INTO workflow_calls (call_key, run_key, state) VALUES (${key}, ${runKey}, 'running')
      ON CONFLICT (call_key) DO NOTHING`,
  );
  return { ...database, read: (asked) => Effect.tap(database.read(asked), () => started) };
}

describe('the cancel of a call no row of which was read', () => {
  it('cancels by its state the row a start recorded between its read and its tombstone, and answers no close of a run that is not closed', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const interrupted: string[] = [];

    const receipt = await Effect.runPromise(
      cancelledCall(
        {
          database: startedAfterItsFirstRead(database),
          cancelChild: () => Effect.succeed('requested'),
          interrupt: (interruptedKey) =>
            Effect.sync(() => {
              interrupted.push(interruptedKey);
            }),
        },
        { call: cancelling, run: { runId: runKey, attributes: {} }, origin: { version: 3 } },
      ),
    );

    expect([receipt, interrupted]).toEqual(['cancelled', [key]]);
    expect(await Effect.runPromise(callRowOf(database, key))).toMatchObject({ state: 'cancelled' });
  });
});

const origin = { version: 1 };

const run = { runId: 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes: {} };

const call: StartCall = {
  kind: 'start_call',
  key: { runId: run.runId, reference: '/do/0/ask', run: 1 },
  function: 'notify',
  arguments: { to: 'ada' },
  longestMs: 60_000,
};

function readsOfTheWaiting({ strings }: Statement): boolean {
  return strings.join('').includes("WHERE state = 'waiting' ORDER BY call_key");
}

function failingOnce(database: HostDatabase): HostDatabase {
  const failures = { left: 1 };
  return {
    ...database,
    read: (query) =>
      Effect.suspend(() => {
        if (readsOfTheWaiting(query) && failures.left > 0) {
          failures.left -= 1;
          return Effect.fail(new DatabaseFailed({ detail: 'The database was told to fail' }));
        }
        return database.read(query);
      }),
  };
}

describe('the first resume of an executor', () => {
  it('answers each waiting call whose run has ended, and reads the waiting calls again at the next when it could not', async () => {
    const database = failingOnce(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const troubles: string[] = [];
    const answered: CallAnsweredResult[] = [];
    const ended: { result?: CallAnsweredResult } = {};
    const executor = hostExecutor({
      now: Date.now,
      database,
      perform: () => Effect.succeed({ status: 'waiting', child: 'child-1' }),
      deliver: (_key, result) =>
        Effect.sync(() => {
          answered.push(result);
        }),
      trouble: (what) =>
        Effect.sync(() => {
          troubles.push(what);
        }),
      mostAtOnce: 1,
      mostOpen: 1000,
      childOf: () => null,
      childAnswerOf: () => Effect.sync(() => ended.result),
      cancelChild: () => Effect.succeed('requested'),
    });
    await Effect.runPromise(executor.executor.start(call, run, origin));
    await Effect.runPromise(executor.idle());
    ended.result = { status: 'succeeded', output: 'checked' };

    await Effect.runPromise(executor.resume());
    const afterTheFailure = [...answered];
    await Effect.runPromise(executor.resume());
    await Effect.runPromise(executor.idle());
    await Effect.runPromise(executor.resume());

    expect(troubles).toEqual(['The calls that wait for runs could not be read; the next sweep reads them again']);
    expect([afterTheFailure, answered]).toEqual([[], [{ status: 'succeeded', output: 'checked' }]]);
  });
});

const root = '0199a3c4-7d2e-7c1a-9b3f-000000000999';

const attributes = { lineage: { start: 'start-1', correlation: root } };

function runOf(id: string) {
  return { runId: `acme/alpha/0199a3c4-7d2e-7c1a-9b3f-00000000000${id}`, attributes };
}

function callOf(runId: string): StartCall {
  return {
    kind: 'start_call',
    key: { runId, reference: '/do/0/ask', run: 1 },
    function: 'notify',
    arguments: { to: 'ada' },
    longestMs: 60_000,
  };
}

function isCountOfOpenCalls({ strings }: Statement): boolean {
  return strings.join('').includes('COUNT(*) AS open');
}

function countsThatMeet(database: HostDatabase): HostDatabase {
  const met = Deferred.makeUnsafe<void>();
  const arrivals = { count: 0 };
  const meeting = Effect.suspend(() => {
    arrivals.count += 1;
    return arrivals.count >= 2 ? Deferred.done(met, Exit.void) : Effect.void;
  }).pipe(Effect.andThen(Effect.race(Deferred.await(met), Effect.sleep('200 millis'))));
  return {
    ...database,
    read: (query) =>
      isCountOfOpenCalls(query) ? Effect.tap(database.read(query), () => meeting) : database.read(query),
  };
}

const States = Schema.Array(Schema.Struct({ state: Schema.String }));

describe('the open calls of runs of one tree that start at the same moment', () => {
  it('are counted and recorded one run after another, so only as many begin as the bound allows', async () => {
    const database = countsThatMeet(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const answered: CallAnsweredResult[] = [];
    const executor = hostExecutor({
      now: Date.now,
      database,
      perform: () => Effect.never,
      deliver: (_key, result) =>
        Effect.sync(() => {
          answered.push(result);
        }),
      trouble: () => Effect.void,
      mostAtOnce: 4,
      mostOpen: 1,
      childOf: () => null,
      childAnswerOf: () => Effect.undefined,
      cancelChild: () => Effect.succeed('requested'),
    });
    const [first, second] = [runOf('1'), runOf('2')];

    await Effect.runPromise(
      Effect.all(
        [
          executor.executor.start(callOf(first.runId), first, origin),
          executor.executor.start(callOf(second.runId), second, origin),
        ],
        {
          concurrency: 'unbounded',
        },
      ),
    );
    await until(
      (): readonly CallAnsweredResult[] => answered,
      (answers) => answers.length > 0,
    );
    const states = Schema.decodeUnknownSync(States)(
      await Effect.runPromise(database.read(statement`SELECT state FROM workflow_calls ORDER BY state`)),
    );
    await Effect.runPromise(executor.stop());

    expect(states).toEqual([{ state: 'answered' }, { state: 'running' }]);
    expect(answered).toMatchObject([{ status: 'rejected', reason: 'conflict' }]);
  });
});
