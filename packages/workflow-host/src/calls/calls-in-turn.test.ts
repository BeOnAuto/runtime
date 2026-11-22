import type { CallResult } from '@on.auto/operations';
import { callKeyText, type CallKey, type StartCall } from '@on.auto/workflow-engine';
import { Deferred, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runKey } from '../suite-testing/probe-subjects.ts';
import { aLedgerInMemory, openedOn } from '../testing/host-files.ts';
import { signals } from '../testing/signals.ts';
import { steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
import { hostExecutor, type HostExecutor } from './host-executor.ts';

const origin = { version: 2 };

const run = { runId: runKey, attributes: { org: 'acme' } };

const sent: CallResult = { status: 'succeeded', output: 'sent' };

function callAt(step: number): StartCall {
  return {
    kind: 'start_call',
    key: { runId: runKey, reference: `/do/${step}/notify`, run: 1 },
    function: 'notify',
    arguments: { to: 'ada' },
    longestMs: 60_000,
  };
}

const holdingCall = callAt(1);

const queuedCall = callAt(2);

const cancelledCall = callAt(3);

const lastCall = callAt(4);

const holding = callKeyText(holdingCall.key);

const queued = callKeyText(queuedCall.key);

const last = callKeyText(lastCall.key);

interface InTurn {
  readonly executor: HostExecutor;
  readonly performed: () => readonly string[];
  readonly answered: () => readonly string[];
  readonly performedAtLeast: (count: number) => Promise<number>;
}

interface TakingTurnsOn {
  readonly clock: SteppedClock;
  readonly queuedOnTheClock: boolean;
  /** The answer of each call by the text of its key; a call not named here answers at once. */
  readonly answers: ReadonlyMap<string, Effect.Effect<CallResult>>;
}

/** An executor whose calls take turns at its one permit, waiting their turns queued on the clock or as in production. */
async function takingTurnsAtOnePermit({ clock, queuedOnTheClock, answers }: TakingTurnsOn): Promise<InTurn> {
  const performed: string[] = [];
  const answered: string[] = [];
  const told = signals();
  const executor = hostExecutor({
    database: await openedOn(await aLedgerInMemory()),
    now: Date.now,
    perform: (asked) =>
      Effect.suspend(() => {
        performed.push(callKeyText(asked.key));
        told.changed();
        return answers.get(callKeyText(asked.key)) ?? Effect.succeed(sent);
      }),
    deliver: (key: CallKey) =>
      Effect.sync(() => {
        answered.push(callKeyText(key));
      }),
    trouble: () => Effect.void,
    mostAtOnce: 1,
    mostOpen: 1000,
    childOf: () => null,
    childAnswerOf: () => Effect.undefined,
    cancelChild: () => Effect.succeed('requested'),
    ...(queuedOnTheClock ? { queued: clock.queued, context: clock.watching() } : {}),
  });
  return {
    executor,
    performed: () => performed,
    answered: () => answered,
    performedAtLeast: (count) =>
      told.when(
        () => performed.length,
        (made) => made >= count,
      ),
  };
}

describe.each([
  { clock: 'the system', queuedOnTheClock: false },
  { clock: 'a stepped', queuedOnTheClock: true },
] as const)(
  'the calls of the executor taking turns at its one permit, waiting on $clock clock',
  ({ queuedOnTheClock }) => {
    it('performs the calls in the order they asked, each once the one before let the permit go, and never one cancelled while it waited', async () => {
      const finishing = Deferred.makeUnsafe<CallResult>();
      const turns = await takingTurnsAtOnePermit({
        clock: steppedClock(0),
        queuedOnTheClock,
        answers: new Map([[holding, Deferred.await(finishing)]]),
      });
      await Effect.runPromise(
        Effect.forEach(
          [holdingCall, queuedCall, cancelledCall, lastCall],
          (asked) => turns.executor.executor.start(asked, run, origin),
          { discard: true },
        ),
      );
      await turns.performedAtLeast(1);
      const whileTheFirstHoldsIt = [...turns.performed()];

      await Effect.runPromise(
        turns.executor.executor.cancel({ kind: 'cancel_call', key: cancelledCall.key }, run, origin),
      );
      await Effect.runPromise(Deferred.succeed(finishing, sent));
      await Effect.runPromise(turns.executor.idle());

      expect([whileTheFirstHoldsIt, turns.performed(), turns.answered()]).toEqual([
        [holding],
        [holding, queued, last],
        [holding, queued, last],
      ]);
    });
  },
);

describe('a call of the executor queued on a stepped clock behind one held by the test', () => {
  it('lets the host come to rest while the call waits its turn, and names that call awake once it performs', async () => {
    const clock = steppedClock(0);
    const held = clock.hold();
    const performing = Promise.withResolvers<CallResult>();
    const turns = await takingTurnsAtOnePermit({
      clock,
      queuedOnTheClock: true,
      answers: new Map([
        [holding, Effect.andThen(held.wait, Effect.succeed(sent))],
        [queued, Effect.promise(() => performing.promise)],
      ]),
    });
    await Effect.runPromise(turns.executor.executor.start(holdingCall, run, origin));
    await Effect.runPromise(turns.executor.executor.start(queuedCall, run, origin));

    await clock.atRest();
    const whileQueued = clock.awake();
    held.release();
    await turns.performedAtLeast(2);
    const inItsTurn = clock.awake();
    performing.resolve(sent);
    await Effect.runPromise(turns.executor.idle());

    expect(whileQueued).toEqual([]);
    expect(inItsTurn).toContain(`call notify ${queued}`);
  });
});
