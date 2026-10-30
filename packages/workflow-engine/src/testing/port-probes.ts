import type { CallResult } from '@on.auto/operations';
import { Effect } from 'effect';

import type { OutputOrigin, RunContext } from '../dispatch/dispatch-watermark.ts';
import type { ArmTimer, CancelCall, StartCall } from '../dispatch/run-output.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { Executor } from '../executor/executor.ts';
import type { Timers } from '../timers/timers.ts';

export interface Probe<Subject> {
  readonly title: string;
  readonly expected: readonly string[];
  readonly run: (subject: Subject) => Effect.Effect<readonly string[], unknown>;
}

export interface TimerSubject {
  readonly timers: Timers;
  readonly run: RunContext;
  readonly otherRun: RunContext;
  readonly now: () => number;
  readonly settle: () => Effect.Effect<readonly string[], unknown>;
}

export interface ExecutorSubject {
  readonly executor: Executor;
  readonly run: RunContext;
  readonly finish: (call: StartCall, result: CallResult) => Effect.Effect<void, unknown>;
  readonly loseHost: (call: StartCall) => Effect.Effect<void, unknown>;
  readonly settle: () => Effect.Effect<readonly string[], unknown>;
}

function timerOf({ run, now }: Pick<TimerSubject, 'run' | 'now'>, sequence: number): ArmTimer {
  return {
    kind: 'arm_timer',
    runId: run.runId,
    timerId: String(sequence),
    dueAt: now() + 1000,
    purpose: 'wait',
  };
}

const armedBy: OutputOrigin = { version: 1 };

function cancelOf({ runId, timerId }: ArmTimer): {
  readonly kind: 'cancel_timer';
  readonly runId: string;
  readonly timerId: string;
} {
  return { kind: 'cancel_timer', runId, timerId };
}

function firedOf(timerIds: readonly string[]): string {
  return timerIds.length === 0
    ? 'fired nothing'
    : `fired ${timerIds.map((id) => id.slice(id.lastIndexOf('/') + 1)).join(' ')}`;
}

export const timerProbes: readonly Probe<TimerSubject>[] = [
  {
    title: 'arms a timer once and fires it once',
    expected: ['armed', 'already_armed', 'fired 1', 'already_armed', 'already_fired'],
    run: (subject) =>
      Effect.gen(function* () {
        const timer = timerOf(subject, 1);
        const first = yield* subject.timers.arm(timer, subject.run, armedBy);
        const again = yield* subject.timers.arm(timer, subject.run, armedBy);
        const fired = yield* subject.settle();
        const afterFiring = yield* subject.timers.arm(timer, subject.run, armedBy);
        const cancel = yield* subject.timers.cancel(cancelOf(timer), subject.run);
        return [first, again, firedOf(fired), afterFiring, cancel];
      }),
  },
  {
    title: 'never fires a timer it cancelled, and refuses to arm it again',
    expected: ['armed', 'cancelled', 'refused_after_cancel', 'fired nothing'],
    run: (subject) =>
      Effect.gen(function* () {
        const timer = timerOf(subject, 2);
        const armed = yield* subject.timers.arm(timer, subject.run, armedBy);
        const cancelled = yield* subject.timers.cancel(cancelOf(timer), subject.run);
        const refused = yield* subject.timers.arm(timer, subject.run, armedBy);
        return [armed, cancelled, refused, firedOf(yield* subject.settle())];
      }),
  },
  {
    title: 'refuses to arm a timer cancelled before it was armed',
    expected: ['tombstoned', 'refused_after_cancel', 'fired nothing'],
    run: (subject) =>
      Effect.gen(function* () {
        const timer = timerOf(subject, 3);
        const cancelled = yield* subject.timers.cancel(cancelOf(timer), subject.run);
        const refused = yield* subject.timers.arm(timer, subject.run, armedBy);
        return [cancelled, refused, firedOf(yield* subject.settle())];
      }),
  },
  {
    title: 'arms again, when swept, a timer it lost, and no timer it has',
    expected: ['armed', 'swept 1', 'fired 4 5', 'swept 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const kept = timerOf(subject, 4);
        const lost = timerOf(subject, 5);
        const armed = yield* subject.timers.arm(kept, subject.run, armedBy);
        const swept = yield* subject.timers.sweep(subject.run, [kept, lost]);
        const fired = yield* subject.settle();
        const sweptAgain = yield* subject.timers.sweep(subject.run, [kept, lost]);
        return [armed, `swept ${swept}`, firedOf(fired), `swept ${sweptAgain}`];
      }),
  },
  {
    title: 'keeps apart the timers of two runs that have the same id, since a timer id is unique only in its run',
    expected: ['armed', 'armed', 'cancelled', 'fired 6'],
    run: (subject) =>
      Effect.gen(function* () {
        const ours = timerOf(subject, 6);
        const theirs = timerOf({ run: subject.otherRun, now: subject.now }, 6);
        const armed = yield* subject.timers.arm(ours, subject.run, armedBy);
        const armedToo = yield* subject.timers.arm(theirs, subject.otherRun, armedBy);
        const cancelled = yield* subject.timers.cancel(cancelOf(ours), subject.run);
        return [armed, armedToo, cancelled, firedOf(yield* subject.settle())];
      }),
  },
];

function callOf({ run }: ExecutorSubject, reference: string): StartCall {
  return {
    kind: 'start_call',
    key: { runId: run.runId, reference, run: 1 },
    function: 'notify',
    arguments: { to: 'ada' },
    longestMs: 60_000,
  };
}

function cancelCallOf({ key }: StartCall): CancelCall {
  return { kind: 'cancel_call', key, reason: 'parent_ended' };
}

const startedBy: OutputOrigin = { version: 1 };

const cancelledBy: OutputOrigin = { version: 2 };

function answeredOf(subject: ExecutorSubject, call: StartCall): Effect.Effect<string, unknown> {
  const key = callKeyText(call.key);
  return Effect.map(
    subject.settle(),
    (answered) => `answered ${answered.filter((answeredKey) => answeredKey === key).length} of ${answered.length}`,
  );
}

const succeeded: CallResult = { status: 'succeeded', output: 'sent' };

export const executorProbes: readonly Probe<ExecutorSubject>[] = [
  {
    title: 'answers a call once, and gives the answer again to a start that comes after it',
    expected: ['started', 'running', 'answered 1 of 1', 'answered_again', 'answered 1 of 1', 'already_answered'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/first');
        const started = yield* subject.executor.start(call, subject.run, startedBy);
        const running = yield* subject.executor.start(call, subject.run, startedBy);
        yield* subject.finish(call, succeeded);
        const answered = yield* answeredOf(subject, call);
        const again = yield* subject.executor.start(call, subject.run, startedBy);
        const answeredAgain = yield* answeredOf(subject, call);
        const cancel = yield* subject.executor.cancel(cancelCallOf(call), subject.run, cancelledBy);
        return [started, running, answered, again, answeredAgain, cancel];
      }),
  },
  {
    title: 'refuses to start a call cancelled before it started',
    expected: ['tombstoned', 'refused_after_cancel', 'answered 0 of 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/second');
        const cancelled = yield* subject.executor.cancel(cancelCallOf(call), subject.run, cancelledBy);
        const refused = yield* subject.executor.start(call, subject.run, startedBy);
        return [cancelled, refused, yield* answeredOf(subject, call)];
      }),
  },
  {
    title: 'starts again a call whose host died before it answered',
    expected: ['started', 'started_again', 'answered 1 of 1'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/third');
        const started = yield* subject.executor.start(call, subject.run, startedBy);
        yield* subject.loseHost(call);
        const again = yield* subject.executor.start(call, subject.run, startedBy);
        yield* subject.finish(call, succeeded);
        return [started, again, yield* answeredOf(subject, call)];
      }),
  },
  {
    title: 'cancels a call it is running, and refuses to start it again',
    expected: ['started', 'cancelled', 'refused_after_cancel', 'answered 0 of 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/fourth');
        const started = yield* subject.executor.start(call, subject.run, startedBy);
        const cancelled = yield* subject.executor.cancel(cancelCallOf(call), subject.run, cancelledBy);
        const refused = yield* subject.executor.start(call, subject.run, startedBy);
        return [started, cancelled, refused, yield* answeredOf(subject, call)];
      }),
  },
];
