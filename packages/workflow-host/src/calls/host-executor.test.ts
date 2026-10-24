import type { CallResult } from '@on.auto/operations';
import { callKeyText, type CallKey, type StartCall } from '@on.auto/workflow-engine';
import { Deferred, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runKey } from '../suite-testing/probe-subjects.ts';
import { faultyDatabase, type FaultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import type { CallAttempt } from './call-starts.ts';
import { hostExecutor, type Deliver, type HostExecutor } from './host-executor.ts';

const origin = { version: 2 };

const run = { runId: runKey, attributes: { org: 'acme' } };

const call: StartCall = {
  kind: 'start_call',
  key: { runId: runKey, reference: '/do/0/notify', run: 1 },
  function: 'notify',
  arguments: { to: 'ada' },
  longestMs: 60_000,
};

const sent: CallResult = { status: 'succeeded', output: 'sent' };

interface Executing {
  readonly database: FaultyDatabase;
  readonly executorOn: (deliver?: Deliver) => HostExecutor;
  readonly performed: () => number;
  readonly attempts: () => readonly CallAttempt[];
  readonly answered: () => readonly string[];
  readonly troubles: () => readonly string[];
}

type Answer = (database: FaultyDatabase) => Effect.Effect<CallResult>;

const answeredSent: Answer = () => Effect.succeed(sent);

const neverAnswered: Answer = () => Effect.never;

async function executing(answer: Answer = answeredSent): Promise<Executing> {
  const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
  const counts = { performed: 0 };
  const attempts: CallAttempt[] = [];
  const answered: string[] = [];
  const troubles: string[] = [];
  const deliverAnswer: Deliver = (key: CallKey) =>
    Effect.sync(() => {
      answered.push(callKeyText(key));
    });
  return {
    database,
    executorOn: (deliver = deliverAnswer) =>
      hostExecutor({
        now: Date.now,
        database,
        perform: (_call, _run, _origin, attempt) =>
          Effect.suspend(() => {
            counts.performed += 1;
            attempts.push(attempt);
            return answer(database);
          }),
        deliver,
        trouble: (what) =>
          Effect.sync(() => {
            troubles.push(what);
          }),
        mostAtOnce: 2,
        mostOpen: 1000,
        childOf: () => null,
        childAnswerOf: () => Effect.undefined,
        cancelChild: () => Effect.succeed('requested'),
      }),
    performed: () => counts.performed,
    attempts: () => attempts,
    answered: () => answered,
    troubles: () => troubles,
  };
}

describe('the executor of the host', () => {
  it('starts again, when it resumes, a call that a host that died was running', async () => {
    const calls = await executing(neverAnswered);
    const died = calls.executorOn();
    await Effect.runPromise(died.executor.start(call, run, origin));
    await Effect.runPromise(died.stop());

    const resumed = calls.executorOn();
    const restarted = await Effect.runPromise(resumed.resume());
    const resumedAgain = await Effect.runPromise(resumed.resume());

    expect([restarted, resumedAgain, calls.performed()]).toEqual([1, 0, 2]);
    expect(calls.attempts()).toEqual([{ attemptDied: false }, { attemptDied: true }]);
    await Effect.runPromise(resumed.stop());
  });

  it('starts again a call a host that died was running when its run asks for it, saying the attempt died', async () => {
    const calls = await executing(neverAnswered);
    const died = calls.executorOn();
    await Effect.runPromise(died.executor.start(call, run, origin));
    await Effect.runPromise(died.stop());

    const again = calls.executorOn();
    const receipt = await Effect.runPromise(again.executor.start(call, run, origin));

    expect([receipt, calls.attempts()]).toEqual(['started_again', [{ attemptDied: false }, { attemptDied: true }]]);
    await Effect.runPromise(again.stop());
  });

  it('stops the calls it runs without reporting them as troubles', async () => {
    const calls = await executing(neverAnswered);
    const executor = calls.executorOn();
    await Effect.runPromise(executor.executor.start(call, run, origin));
    await Effect.runPromise(executor.executor.cancel({ kind: 'cancel_call', key: call.key }, run, origin));
    await Effect.runPromise(executor.executor.start({ ...call, key: { ...call.key, run: 2 } }, run, origin));

    await Effect.runPromise(executor.stop());

    expect(calls.troubles()).toEqual([]);
  });
});

describe('the executor of the host, after a host died', () => {
  it('cancels a call that a host that died was running, interrupting nothing', async () => {
    const calls = await executing(neverAnswered);
    const died = calls.executorOn();
    await Effect.runPromise(died.executor.start(call, run, origin));
    await Effect.runPromise(died.stop());

    const cancelled = await Effect.runPromise(
      calls.executorOn().executor.cancel({ kind: 'cancel_call', key: call.key }, run, origin),
    );

    expect(cancelled).toBe('cancelled');
  });
});

describe('the executor of the host, answering', () => {
  it('gives no answer of a call that another host cancelled while it ran', async () => {
    const finishing = Deferred.makeUnsafe<CallResult>();
    const calls = await executing(() => Deferred.await(finishing));
    const running = calls.executorOn();
    await Effect.runPromise(running.executor.start(call, run, origin));
    const cancel = { kind: 'cancel_call', key: call.key } as const;

    const cancelled = await Effect.runPromise(calls.executorOn().executor.cancel(cancel, run, origin));
    const cancelledAgain = await Effect.runPromise(calls.executorOn().executor.cancel(cancel, run, origin));
    await Effect.runPromise(Deferred.succeed(finishing, sent));
    await Effect.runPromise(running.idle());

    expect([cancelled, cancelledAgain, calls.answered()]).toEqual(['cancelled', 'cancelled', []]);
  });

  it('keeps an answer it could not give to its run, and gives it when it next resumes', async () => {
    const calls = await executing();
    const refusing = calls.executorOn(() => Effect.fail(new Error('The run is busy')));
    await Effect.runPromise(refusing.executor.start(call, run, origin));
    await Effect.runPromise(refusing.idle());

    const giving = calls.executorOn();
    const resumed = await Effect.runPromise(giving.resume());
    await Effect.runPromise(giving.idle());

    expect([resumed, calls.performed(), calls.answered()]).toEqual([1, 1, [callKeyText(call.key)]]);
    expect(calls.troubles()).toEqual(['An answer of a call could not be given to its run']);
    expect(await Effect.runPromise(giving.resume())).toBe(0);
  });
});

describe('the executor of the host, resuming recorded answers', () => {
  it.each<CallResult>([
    { status: 'failed', detail: 'The run failed with incident inc-1' },
    {
      status: 'rejected',
      reason: 'invalid_arguments',
      detail: 'The input of run_definition takes 262211 bytes as JSON, more than the 262144 a run takes',
    },
  ])('gives a recorded $status answer, as it was recorded, when it next resumes', async (recorded) => {
    const calls = await executing(() => Effect.succeed(recorded));
    const refusing = calls.executorOn(() => Effect.fail(new Error('The run is busy')));
    await Effect.runPromise(refusing.executor.start(call, run, origin));
    await Effect.runPromise(refusing.idle());
    const answers: CallResult[] = [];
    const giving = calls.executorOn((_key, result) =>
      Effect.sync(() => {
        answers.push(result);
      }),
    );

    expect(await Effect.runPromise(giving.resume())).toBe(1);
    await Effect.runPromise(giving.idle());

    expect(answers).toEqual([recorded]);
    expect(calls.performed()).toBe(1);
    expect(await Effect.runPromise(giving.resume())).toBe(0);
  });
});

describe('the executor of the host, failing to record an answer', () => {
  it('writes it again until it is written, never performing the call again meanwhile, and then gives it', async () => {
    const calls = await executing((database) =>
      Effect.sync(() => {
        database.failingWrites(true);
        return sent;
      }),
    );
    const executor = calls.executorOn();

    await Effect.runPromise(executor.executor.start(call, run, origin));
    await until(calls.troubles, (troubles) => troubles.length > 0);
    const refusedByTheTrouble = calls.database.writesRefused();
    await until(calls.database.writesRefused, (refused) => refused > refusedByTheTrouble);
    const resumedWhileWriting = await Effect.runPromise(executor.resume());
    calls.database.failingWrites(false);
    await Effect.runPromise(executor.idle());

    expect([resumedWhileWriting, calls.performed(), calls.answered()]).toEqual([0, 1, [callKeyText(call.key)]]);
    expect(calls.troubles()).toEqual(['An answer of a call could not be recorded; it is written again until it is']);
  });
});

describe('the executor of the host, asked twice at once', () => {
  it('never starts a second performance of a call it is already performing', async () => {
    const calls = await executing(neverAnswered);
    const died = calls.executorOn();
    await Effect.runPromise(died.executor.start(call, run, origin));
    await Effect.runPromise(died.stop());

    const resumed = calls.executorOn();
    await Effect.runPromise(
      Effect.all([resumed.resume(), resumed.executor.start(call, run, origin), resumed.resume()], {
        concurrency: 'unbounded',
      }),
    );

    expect(calls.performed()).toBe(2);
    await Effect.runPromise(resumed.stop());
  });
});

describe('the executor of the host, stopped', () => {
  it('records a call it is asked to start, but begins it only when a host resumes it', async () => {
    const calls = await executing();
    const stopped = calls.executorOn();
    await Effect.runPromise(stopped.stop());

    const started = await Effect.runPromise(stopped.executor.start(call, run, origin));
    const resumed = await Effect.runPromise(calls.executorOn().resume());

    expect([started, resumed]).toEqual(['started', 1]);
  });
});

describe('the executor of the host, failing', () => {
  it('fails a start or a cancel it cannot record, to be dispatched again', async () => {
    const calls = await executing();
    const executor = calls.executorOn();
    calls.database.failing(true);

    const start = await Effect.runPromise(Effect.flip(executor.executor.start(call, run, origin)));
    const cancel = await Effect.runPromise(
      Effect.flip(executor.executor.cancel({ kind: 'cancel_call', key: call.key }, run, origin)),
    );

    expect([start.output, cancel.output]).toEqual(['start_call', 'cancel_call']);
    expect(start.detail).toBe('The database was told to fail');
  });
});
