import type { Statement } from '@on.auto/ledger';
import type { CallResult } from '@on.auto/operations';
import type { StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostExecutor } from './host-executor.ts';

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
    const answered: CallResult[] = [];
    const ended: { result?: CallResult } = {};
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
