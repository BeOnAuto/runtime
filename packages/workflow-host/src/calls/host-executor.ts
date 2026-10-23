import type { CallResult } from '@on.auto/operations';
import {
  DispatchFailed,
  callKeyText,
  type CallKey,
  type Executor,
  type OutputOrigin,
  type RunContext,
  type StartCall,
  type StartReceipt,
} from '@on.auto/workflow-engine';
import { Effect, Schedule, Semaphore, type Cause, type Context } from 'effect';

import type { DatabaseFailed, HostDatabase } from '../database/host-database.ts';
import { runSerialiser } from '../dispatch/run-serialiser.ts';
import { correlationOfRun } from '../runs/run-lineage.ts';
import { callSpanOf, currentSpanIdentity, type SpanIdentity } from '../runs/run-spans.ts';
import { background, type Background } from './background.ts';
import { cancelledCall, type CancelChild } from './call-cancels.ts';
import {
  allWaitingCalls,
  answeredRow,
  deliveredRow,
  existingRowOf,
  openCallsUnder,
  refusedRow,
  startedRow,
  unfinishedCalls,
  waitingRow,
  type CallRow,
  type UnfinishedCall,
  type WaitingCall,
} from './call-rows.ts';

interface Waiting {
  readonly status: 'waiting';
  readonly child: string;
}

export type CallAnswer = CallResult | Waiting;

export interface CallAttempt {
  readonly attemptDied: boolean;
}

export type Perform = (
  call: StartCall,
  run: RunContext,
  origin: OutputOrigin,
  attempt: CallAttempt,
) => Effect.Effect<CallAnswer>;

const firstAttempt: CallAttempt = { attemptDied: false };

const afterAnAttemptDied: CallAttempt = { attemptDied: true };

export type Deliver = (key: CallKey, result: CallResult) => Effect.Effect<unknown, unknown>;

export type Trouble = (what: string, cause: Cause.Cause<unknown>) => Effect.Effect<void>;

export interface ExecutorParts {
  readonly database: HostDatabase;
  readonly perform: Perform;
  readonly deliver: Deliver;
  readonly trouble: Trouble;
  readonly mostAtOnce: number;
  readonly mostOpen: number;
  readonly childOf: (call: StartCall, run: RunContext) => string | null;
  readonly childAnswerOf: (runKey: string, child: string) => Effect.Effect<CallResult | undefined>;
  readonly cancelChild: CancelChild;
  readonly context?: Context.Context<never> | undefined;
}

export interface HostExecutor {
  readonly executor: Executor;
  readonly resume: () => Effect.Effect<number>;
  readonly idle: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

interface Starting {
  readonly call: StartCall;
  readonly run: RunContext;
  readonly origin: OutputOrigin;
}

interface Calls {
  readonly begin: (key: string, starting: Starting, attempt: CallAttempt, parent?: SpanIdentity) => void;
  readonly answerAgain: (key: string, callKey: CallKey, result: CallResult) => void;
  readonly isRunning: (key: string) => boolean;
  readonly interrupt: (key: string) => Effect.Effect<void>;
  readonly answeredIfEnded: (waiting: WaitingCall) => Effect.Effect<void, DatabaseFailed>;
  readonly underItsRoot: <A, E>(root: string, work: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

const answerWrittenAgain = Schedule.min([Schedule.exponential('50 millis'), Schedule.spaced('30 seconds')]);

function writtenUntilItIs<A>(
  written: Effect.Effect<A, DatabaseFailed>,
  trouble: Trouble,
): Effect.Effect<A, DatabaseFailed> {
  const failures = { reported: false };
  return written.pipe(
    Effect.tapCause((cause: Cause.Cause<unknown>) => {
      if (failures.reported) {
        return Effect.void;
      }
      failures.reported = true;
      return trouble('An answer of a call could not be recorded; it is written again until it is', cause);
    }),
    Effect.retry(answerWrittenAgain),
  );
}

function failedTo(output: 'start_call' | 'cancel_call') {
  return ({ detail }: { readonly detail: string }) => new DispatchFailed({ output, detail });
}

function tooManyOpen(mostOpen: number): CallResult {
  return {
    status: 'rejected',
    reason: 'conflict',
    detail: `The runs under the run at the top of this tree already wait for ${mostOpen} calls, the most one tree of runs may have open, so this call was not started`,
  };
}

function callsOf(parts: ExecutorParts, running: Background): Calls {
  const { database, perform, deliver, trouble, mostAtOnce } = parts;
  const atOnce = Semaphore.makeUnsafe(mostAtOnce);
  const delivered = (key: string, callKey: CallKey, result: CallResult): Effect.Effect<void> =>
    deliver(callKey, result).pipe(
      Effect.andThen(deliveredRow(database, key)),
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        trouble('An answer of a call could not be given to its run', cause),
      ),
    );
  const settled = (key: string, call: StartCall, result: CallResult): Effect.Effect<void, DatabaseFailed> =>
    Effect.flatMap(writtenUntilItIs(answeredRow(database, key, result), trouble), (written) =>
      written ? delivered(key, call.key, result) : Effect.void,
    );
  const answeredIfEnded = ({ key, call, child }: WaitingCall): Effect.Effect<void, DatabaseFailed> =>
    Effect.flatMap(parts.childAnswerOf(call.key.runId, child), (ended) =>
      ended === undefined ? Effect.void : settled(key, call, ended),
    );
  const waited = (key: string, call: StartCall, child: string): Effect.Effect<void, DatabaseFailed> =>
    writtenUntilItIs(waitingRow(database, key, child), trouble).pipe(
      Effect.andThen(answeredIfEnded({ key, call, child })),
    );
  const answered = (key: string, call: StartCall, answer: CallAnswer): Effect.Effect<void, DatabaseFailed> =>
    answer.status === 'waiting' ? waited(key, call, answer.child) : settled(key, call, answer);
  const roots = runSerialiser();
  return {
    begin: (key, { call, run, origin }, attempt, parent) => {
      running.run(
        key,
        atOnce.withPermit(perform(call, run, origin, attempt)).pipe(
          Effect.flatMap((answer) => answered(key, call, answer)),
          Effect.catchCause((cause: Cause.Cause<unknown>) => trouble('A call could not record its answer', cause)),
          Effect.withSpan(`call ${call.function}`, callSpanOf(call, parent)),
        ),
      );
    },
    answerAgain: (key, callKey, result) => {
      running.run(key, delivered(key, callKey, result));
    },
    isRunning: running.has,
    interrupt: running.interrupt,
    answeredIfEnded,
    underItsRoot: roots.serialise,
  };
}

function startedOnce(
  { database, mostOpen, childOf }: ExecutorParts,
  calls: Calls,
  { call, run, origin }: Starting,
): Effect.Effect<boolean, DatabaseFailed> {
  return Effect.gen(function* () {
    const key = callKeyText(call.key);
    const root = correlationOfRun(run.runId, run.attributes);
    const open = yield* openCallsUnder(database, root);
    if (open >= mostOpen) {
      const refusal = tooManyOpen(mostOpen);
      const refused = yield* refusedRow(database, key, run, refusal);
      if (refused) {
        calls.answerAgain(key, call.key, refusal);
      }
      return refused;
    }
    const inserted = yield* startedRow(database, key, { call, run, origin, child: childOf(call, run), root });
    if (inserted) {
      calls.begin(key, { call, run, origin }, firstAttempt, yield* currentSpanIdentity);
    }
    return inserted;
  }).pipe((counted) => calls.underItsRoot(correlationOfRun(run.runId, run.attributes), counted));
}

function startedAgain(
  calls: Calls,
  starting: Starting,
  { state, result }: CallRow,
  parent: SpanIdentity | undefined,
): StartReceipt {
  const { call } = starting;
  const key = callKeyText(call.key);
  if (state === 'cancelled') {
    return 'refused_after_cancel';
  }
  if (state === 'answered' && result !== null) {
    calls.answerAgain(key, call.key, result);
    return 'answered_again';
  }
  if (state === 'waiting' || calls.isRunning(key)) {
    return 'running';
  }
  calls.begin(key, starting, afterAnAttemptDied, parent);
  return 'started_again';
}

function started(parts: ExecutorParts, calls: Calls, starting: Starting): Effect.Effect<StartReceipt, DatabaseFailed> {
  return Effect.gen(function* () {
    if (yield* startedOnce(parts, calls, starting)) {
      return 'started';
    }
    const row = yield* existingRowOf(parts.database, callKeyText(starting.call.key));
    return startedAgain(calls, starting, row, yield* currentSpanIdentity);
  });
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
