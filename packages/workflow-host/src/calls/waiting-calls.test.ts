import { statement } from '@on.auto/ledger';
import { messageIdOf, type CallResult } from '@on.auto/operations';
import type { StartCall } from '@on.auto/workflow-engine';
import { Deferred, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { faultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import type { ChildCancel, ChildReceipt } from './call-cancels.ts';
import { hostExecutor, type CallAnswer } from './host-executor.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const root = '0199a3c4-7d2e-7c1a-9b3f-000000000999';

const run = { runId: runKey, attributes: { lineage: { start: 'start-1', correlation: root } } };

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

function callAt(reference: string, runId = runKey): StartCall {
  return {
    kind: 'start_call',
    key: { runId, reference, run: 1 },
    function: 'notify',
    arguments: { to: 'ada' },
    longestMs: 60_000,
  };
}

const origin = { version: 3 };

function waitingAtTheFirst(call: StartCall): Effect.Effect<CallAnswer> {
  return Effect.succeed(
    call.key.reference === '/do/0/a' ? { status: 'waiting', child } : { status: 'succeeded', output: 1 },
  );
}

function heldAtTheFirst(finishing: Effect.Effect<CallAnswer>) {
  return (call: StartCall): Effect.Effect<CallAnswer> =>
    call.key.reference === '/do/0/a' ? finishing : Effect.succeed({ status: 'succeeded', output: 1 });
}

const refusal = {
  status: 'rejected',
  reason: 'conflict',
  detail:
    'The runs under the run at the top of this tree already wait for 2 calls, the most one tree of runs may have open, so this call was not started',
};

const RowsOfCalls = Schema.Array(Schema.Struct({ state: Schema.String, child: Schema.NullOr(Schema.String) }));

interface Executing {
  readonly mostOpen?: number;
  readonly ended?: CallResult;
  readonly receipt?: ChildReceipt;
}

async function executing(
  answer: (call: StartCall) => Effect.Effect<CallAnswer>,
  { mostOpen = 1000, ended, receipt = 'requested' }: Executing = {},
) {
  const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
  const counts = { performed: 0 };
  const answered: CallResult[] = [];
  const cancels: ChildCancel[] = [];
  const executor = hostExecutor({
    database,
    perform: (call) =>
      Effect.suspend(() => {
        counts.performed += 1;
        return answer(call);
      }),
    deliver: (_key, result) =>
      Effect.sync(() => {
        answered.push(result);
      }),
    trouble: () => Effect.void,
    mostAtOnce: 1,
    mostOpen,
    childOf: (call) => `${call.key.reference.slice(-1)}-derived`,
    childAnswerOf: () => Effect.succeed(ended),
    cancelChild: (cancel) =>
      Effect.sync(() => {
        cancels.push(cancel);
        return receipt;
      }),
  });
  const rows = async () =>
    Schema.decodeUnknownSync(RowsOfCalls)(
      await Effect.runPromise(database.read(statement`SELECT state, child FROM workflow_calls ORDER BY call_key`)),
    );
  return {
    database,
    executor,
    rows,
    performed: () => counts.performed,
    answered: (): readonly CallResult[] => answered,
    cancels: () => cancels,
  };
}

describe('a call whose run finishes later', () => {
  it('waits for that run with its id, releasing its permit, and is never performed again', async () => {
    const calls = await executing(waitingAtTheFirst);
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/b'), run, origin));
    await Effect.runPromise(calls.executor.idle());

    const again = await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    const resumed = await Effect.runPromise(calls.executor.resume());

    expect(await calls.rows()).toEqual([
      { state: 'waiting', child },
      { state: 'answered', child: 'b-derived' },
    ]);
    expect([again, resumed, calls.performed()]).toEqual(['running', 0, 2]);
  });
});

describe('a call whose run ended before the call was marked waiting', () => {
  it('is answered at once with the ending of that run, so no answer is lost', async () => {
    const calls = await executing(() => Effect.succeed({ status: 'waiting', child }), {
      ended: { status: 'succeeded', output: 'done' },
    });

    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    await until(calls.answered, (answered) => answered.length > 0);

    expect(calls.answered()).toEqual([{ status: 'succeeded', output: 'done' }]);
    expect(await calls.rows()).toEqual([{ state: 'answered', child }]);
  });
});

describe('the open calls under one run at the top of a tree', () => {
  it('are bounded, the call past the bound answered as a conflict without being performed', async () => {
    const calls = await executing(() => Effect.never, { mostOpen: 2 });
    const elsewhere = { runId: 'acme/alpha/other', attributes: {} };
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/b'), run, origin));

    const refused = await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/c'), run, origin));
    const another = await Effect.runPromise(
      calls.executor.executor.start(callAt('/do/0/d', 'acme/alpha/other'), elsewhere, origin),
    );
    await until(calls.answered, (answered) => answered.length > 0);
    const refusedAgain = await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/c'), run, origin));
    await until(calls.answered, (answered) => answered.length > 1);

    expect([refused, another, refusedAgain]).toEqual(['started', 'started', 'answered_again']);
    expect((await calls.rows()).map(({ state }) => state)).toEqual(['running', 'running', 'answered', 'running']);
    expect(calls.answered()).toEqual([refusal, refusal]);
    await Effect.runPromise(calls.executor.stop());
  });
});

describe('a cancel of a waiting call', () => {
  it('cancels the run the call waits for, by its id, before marking the call, then names it cancelled', async () => {
    const calls = await executing(() => Effect.succeed({ status: 'waiting', child }));
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    await Effect.runPromise(calls.executor.idle());

    const cancelled = await Effect.runPromise(
      calls.executor.executor.cancel(
        { kind: 'cancel_call', key: callAt('/do/0/a').key, reason: 'deadline' },
        run,
        origin,
      ),
    );
    const again = await Effect.runPromise(
      calls.executor.executor.cancel({ kind: 'cancel_call', key: callAt('/do/0/a').key }, run, origin),
    );

    expect([cancelled, again]).toEqual(['cancelled', 'cancelled']);
    expect(await calls.rows()).toEqual([{ state: 'cancelled', child }]);
    expect(calls.cancels()).toEqual([
      {
        child: { org: 'acme', playbook: 'alpha', runId: child },
        reason: 'deadline',
        lineage: {
          causationId: messageIdOf(`playbook/acme/alpha/run-logs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a`, origin.version),
          correlationId: root,
        },
      },
      expect.objectContaining({ reason: 'parent_ended' }),
    ]);
  });
});

describe('a cancel of a running call', () => {
  it('interrupts the call and cancels the run its arguments name, and leaves an answered one alone', async () => {
    const finishing = Deferred.makeUnsafe<CallAnswer>();
    const calls = await executing(heldAtTheFirst(Deferred.await(finishing)));
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/b'), run, origin));
    await until(calls.answered, (answered) => answered.length > 0);
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    const cancelOf = (reference: string) =>
      calls.executor.executor.cancel(
        { kind: 'cancel_call', key: callAt(reference).key, reason: 'parent_ended' },
        run,
        origin,
      );

    const receipts = await Effect.runPromise(
      Effect.all([cancelOf('/do/0/a'), cancelOf('/do/0/b'), cancelOf('/do/0/c')]),
    );
    await Effect.runPromise(Deferred.succeed(finishing, { status: 'succeeded', output: 2 }));

    expect(receipts).toEqual(['cancelled', 'already_answered', 'tombstoned']);
    expect(calls.cancels().map((cancel) => cancel.child.runId)).toEqual(['a-derived']);
    expect(calls.answered()).toHaveLength(1);
  });
});

describe('a cancel of a call whose run could not be cancelled', () => {
  it('fails to be dispatched again when the run it waits for could not be cancelled', async () => {
    const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const executor = hostExecutor({
      database,
      perform: () => Effect.succeed({ status: 'waiting', child }),
      deliver: () => Effect.void,
      trouble: () => Effect.void,
      mostAtOnce: 1,
      mostOpen: 1000,
      childOf: () => null,
      childAnswerOf: () => Effect.undefined,
      cancelChild: () => Effect.fail({ detail: 'The ledger is busy' }),
    });
    await Effect.runPromise(executor.executor.start(callAt('/do/0/a'), run, origin));
    await Effect.runPromise(executor.idle());

    const failure = await Effect.runPromise(
      Effect.flip(executor.executor.cancel({ kind: 'cancel_call', key: callAt('/do/0/a').key }, run, origin)),
    );

    expect([failure.output, failure.detail]).toEqual(['cancel_call', 'The ledger is busy']);
  });

  it('fails too when the run it waits for is not one its playbook can hold, and leaves the call as it was', async () => {
    const calls = await executing(() => Effect.succeed({ status: 'waiting', child }), { receipt: 'unknown_run' });
    await Effect.runPromise(calls.executor.executor.start(callAt('/do/0/a'), run, origin));
    await Effect.runPromise(calls.executor.idle());

    const failure = await Effect.runPromise(
      Effect.flip(calls.executor.executor.cancel({ kind: 'cancel_call', key: callAt('/do/0/a').key }, run, origin)),
    );

    expect(failure.detail).toBe(
      'The run this call waits for has an address its playbook cannot hold, so it could not be cancelled',
    );
    expect(await calls.rows()).toEqual([{ state: 'waiting', child }]);
  });
});
