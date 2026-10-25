import { type Statement, statement } from '@on.auto/ledger';
import type { CallResult } from '@on.auto/operations';
import type { StartCall } from '@on.auto/workflow-engine';
import { Deferred, Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { hostExecutor } from './host-executor.ts';

const origin = { version: 1 };

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
    const answered: CallResult[] = [];
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
      (): readonly CallResult[] => answered,
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
