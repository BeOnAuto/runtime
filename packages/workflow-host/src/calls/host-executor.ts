import {
  DispatchFailed,
  type CallAnsweredResult,
  type CallKey,
  type Executor,
  type OutputOrigin,
  type RunContext,
  type StartCall,
} from '@on.auto/workflow-engine';
import { Effect, Semaphore, type Cause, type Context } from 'effect';

import type { DatabaseFailed } from '../database/host-database.ts';
import { runSerialiser } from '../dispatch/run-serialiser.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { callSpanOf } from '../runs/run-spans.ts';
import { background, takingTurns, type Background, type InTurn } from './background.ts';
import { cancelledCall, type CancelChild } from './call-cancels.ts';
import {
  allWaitingCalls,
  answeredRow,
  deliveredRow,
  dueAgainRow,
  unfinishedCalls,
  waitingRow,
  type WaitingCallOfARun,
  type UnfinishedCall,
  type WaitingCall,
} from './call-rows.ts';
import { afterAnAttemptDied, started, type CallAttempt, type StartParts, type StartingCalls } from './call-starts.ts';

interface Waiting {
  readonly status: 'waiting';
  readonly child: string;
  readonly resumesAfterMs?: number;
}

export type CallAnswer = CallAnsweredResult | Waiting;

export type Perform = (
  call: StartCall,
  run: RunContext,
  origin: OutputOrigin,
  attempt: CallAttempt,
) => Effect.Effect<CallAnswer>;

export type Deliver = (key: CallKey, result: CallAnsweredResult) => Effect.Effect<unknown, unknown>;

export type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

export interface ExecutorParts extends StartParts {
  readonly perform: Perform;
  readonly deliver: Deliver;
  readonly trouble: Trouble;
  readonly mostAtOnce: number;
  readonly childAnswerOf: (runKey: string, child: string) => Effect.Effect<CallAnsweredResult | undefined>;
  readonly cancelChild: CancelChild;
  readonly now: () => number;
  readonly sleep?: HostClock['sleep'];
  readonly queued?: HostClock['queued'];
  readonly context?: Context.Context<never> | undefined;
}

export interface HostExecutor {
  readonly executor: Executor;
  readonly dispatchedAgain: (waiting: WaitingCallOfARun, at: number) => Effect.Effect<void, DatabaseFailed>;
  readonly resume: () => Effect.Effect<number>;
  readonly idle: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

interface Calls extends StartingCalls {
  readonly interrupt: (key: string) => Effect.Effect<void>;
  readonly answeredIfEnded: (waiting: WaitingCall) => Effect.Effect<void, DatabaseFailed>;
  readonly dispatchedAgain: HostExecutor['dispatchedAgain'];
}

const answerWrittenAgainMs = { firstMs: 50, mostMs: 30_000 };

export function answerWrittenAgainAfterMs(failures: number): number {
  return Math.min(answerWrittenAgainMs.firstMs * 2 ** failures, answerWrittenAgainMs.mostMs);
}

function writtenUntilItIs<A>(
  written: Effect.Effect<A, DatabaseFailed>,
  trouble: Trouble,
  sleep: HostClock['sleep'],
): Effect.Effect<A, DatabaseFailed> {
  const failures = { reported: false };
  const reported = written.pipe(
    Effect.tapCause((cause: Cause.Cause<unknown>) => {
      if (failures.reported) {
        return Effect.void;
      }
      failures.reported = true;
      return trouble('An answer of a call could not be recorded; it is written again until it is', cause);
    }),
  );
  const writtenAfter = (tries: number): Effect.Effect<A, DatabaseFailed> =>
    reported.pipe(
      Effect.catch(() =>
        Effect.andThen(
          sleep(answerWrittenAgainAfterMs(tries)),
          Effect.suspend(() => writtenAfter(tries + 1)),
        ),
      ),
    );
  return writtenAfter(0);
}

function failedTo(output: 'start_call' | 'cancel_call') {
  return ({ detail }: { readonly detail: string }) => new DispatchFailed({ output, detail });
}

type Settled = (key: string, call: StartCall, result: CallAnsweredResult) => Effect.Effect<void, DatabaseFailed>;

function dispatchedAgainBy(
  { database, perform }: ExecutorParts,
  inTurn: InTurn,
  settled: Settled,
): HostExecutor['dispatchedAgain'] {
  return ({ key, call, run, origin, resumesAfterMs }, at) =>
    inTurn(perform(call, run, origin, afterAnAttemptDied)).pipe(
      Effect.flatMap((answer) =>
        answer.status === 'waiting' ? dueAgainRow(database, key, at + resumesAfterMs) : settled(key, call, answer),
      ),
      Effect.withSpan(`call ${call.function}`, callSpanOf(call)),
    );
}

function callsOf(parts: ExecutorParts, running: Background): Calls {
  const { database, perform, deliver, trouble, mostAtOnce, now, sleep = systemClock.sleep } = parts;
  const inTurn = takingTurns(Semaphore.makeUnsafe(mostAtOnce), parts.queued);
  const delivered = (key: string, callKey: CallKey, result: CallAnsweredResult): Effect.Effect<void> =>
    deliver(callKey, result).pipe(
      Effect.andThen(deliveredRow(database, key)),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        trouble('An answer of a call could not be given to its run', cause),
      ),
    );
  const settled: Settled = (key, call, result) =>
    Effect.flatMap(writtenUntilItIs(answeredRow(database, key, result), trouble, sleep), (written) =>
      written ? delivered(key, call.key, result) : Effect.void,
    );
  const answeredIfEnded = ({ key, call, child }: WaitingCall): Effect.Effect<void, DatabaseFailed> =>
    Effect.flatMap(parts.childAnswerOf(call.key.runId, child), (ended) =>
      ended === undefined ? Effect.void : settled(key, call, ended),
    );
  const waited = (key: string, call: StartCall, { child, resumesAfterMs }: Waiting) =>
    writtenUntilItIs(waitingRow(database, key, { child, at: now(), resumesAfterMs }), trouble, sleep).pipe(
      Effect.andThen(answeredIfEnded({ key, call, child })),
    );
  const answered = (key: string, call: StartCall, answer: CallAnswer): Effect.Effect<void, DatabaseFailed> =>
    answer.status === 'waiting' ? waited(key, call, answer) : settled(key, call, answer);
  const roots = runSerialiser();
  return {
    begin: (key, { call, run, origin }, attempt, parent) => {
      running.run(
        key,
        inTurn(perform(call, run, origin, attempt)).pipe(
          Effect.flatMap((answer) => answered(key, call, answer)),
          Effect.catchCause((cause: Cause.Cause<unknown>) => trouble('A call could not record its answer', cause)),
          Effect.withSpan(`call ${call.function}`, callSpanOf(call, parent)),
        ),
        `call ${call.function} ${key}`,
      );
    },
    answerAgain: (key, callKey, result) => {
      running.run(key, delivered(key, callKey, result), `answer ${key}`);
    },
    isRunning: running.has,
    interrupt: running.interrupt,
    answeredIfEnded,
    dispatchedAgain: dispatchedAgainBy(parts, inTurn, settled),
    underItsRoot: roots.serialise,
  };
}

function resumedIn(calls: Calls, { key, call, run, origin, result }: UnfinishedCall): void {
  if (result === null) {
    calls.begin(key, { call, run, origin }, afterAnAttemptDied);
  } else {
    calls.answerAgain(key, call.key, result);
  }
}

function waitingAnsweredOnce(parts: ExecutorParts, calls: Calls): Effect.Effect<void> {
  const swept = { waiting: false };
  return Effect.suspend(() =>
    swept.waiting
      ? Effect.void
      : allWaitingCalls(parts.database).pipe(
          Effect.flatMap((waiting) => Effect.forEach(waiting, calls.answeredIfEnded, { discard: true })),
          Effect.andThen(
            Effect.sync(() => {
              swept.waiting = true;
            }),
          ),
          Effect.catchCause((cause: Cause.Cause<unknown>) =>
            parts.trouble('The calls that wait for runs could not be read; the next sweep reads them again', cause),
          ),
        ),
  );
}

export function hostExecutor(parts: ExecutorParts): HostExecutor {
  const { database } = parts;
  const running = background(parts.context);
  const calls = callsOf(parts, running);
  const waitingAnswered = waitingAnsweredOnce(parts, calls);
  return {
    executor: {
      start: (call, run, origin) =>
        started(parts, calls, { call, run, origin }).pipe(Effect.mapError(failedTo('start_call'))),
      cancel: (call, run, origin) =>
        cancelledCall({ ...parts, interrupt: calls.interrupt }, { call, run, origin }).pipe(
          Effect.mapError(failedTo('cancel_call')),
        ),
    },
    dispatchedAgain: calls.dispatchedAgain,
    resume: () =>
      waitingAnswered.pipe(
        Effect.andThen(Effect.orDie(unfinishedCalls(database))),
        Effect.map((unfinished: readonly UnfinishedCall[]) => unfinished.filter(({ key }) => !running.has(key))),
        Effect.tap((orphaned: readonly UnfinishedCall[]) =>
          Effect.sync(() => {
            for (const call of orphaned) {
              resumedIn(calls, call);
            }
          }),
        ),
        Effect.map((orphaned: readonly UnfinishedCall[]) => orphaned.length),
      ),
    idle: running.idle,
    stop: running.stop,
  };
}
