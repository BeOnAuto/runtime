import { setTimeout } from 'node:timers/promises';

/**
 * How a process is ended: whether it is gone, the signal it is sent, and the promise that settles once it is gone. A
 * child of the test settles that promise on its own `exit`; a process known by its pid alone gives no event, so it is
 * looked for, every `lookEveryMs`, on the timer.
 */
export interface Ending {
  readonly isGone: () => boolean;
  readonly signal: (name: NodeJS.Signals) => unknown;
  readonly gone: (stop: AbortSignal) => Promise<void>;
}

export interface RunningProcess {
  readonly name: string;
  readonly pid: number;
  readonly isStillRunning: () => boolean;
}

/** The time an ending waits on: a promise settled once `ms` passed, rejected if `stop` aborts first. */
export interface Timer {
  readonly after: (ms: number, stop: AbortSignal) => Promise<unknown>;
}

/**
 * The timer of `node:timers/promises`, which the fake timers of a test do not replace, so a process is ended at the
 * finish of a test that faked them.
 */
export const realTimer: Timer = { after: (ms, stop) => setTimeout(ms, undefined, { signal: stop }) };

export const stoppedWithinMs = 10_000;

const lookEveryMs = 50;

/** How a pid is signalled: `kill(pid, signal)`, true where it was sent. Signal 0 asks whether the pid is there. */
export type Signaller = (pid: number, signal: NodeJS.Signals | 0) => boolean;

export const signalled: Signaller = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

/** A pid that gives no event when it is gone, looked for every `everyMs` until it is, or until `stop` aborts. */
export async function lookedForUntilGone(
  isGone: () => boolean,
  stop: AbortSignal,
  timer: Timer,
  everyMs: number,
): Promise<void> {
  if (isGone()) {
    return;
  }
  await timer.after(everyMs, stop);
  await lookedForUntilGone(isGone, stop, timer, everyMs);
}

async function goneWithin(ending: Ending, withinMs: number, timer: Timer): Promise<boolean> {
  const stop = new AbortController();
  try {
    return await Promise.race([
      ending.gone(stop.signal).then(
        () => true,
        () => false,
      ),
      timer.after(withinMs, stop.signal).then(
        () => false,
        () => false,
      ),
    ]);
  } finally {
    stop.abort();
  }
}

/** Ends a process: SIGTERM, then SIGKILL if it is still there `withinMs` later, and settles once it is gone. */
export async function endedWithin(ending: Ending, withinMs: number, timer: Timer = realTimer): Promise<void> {
  if (ending.isGone()) {
    return;
  }
  ending.signal('SIGTERM');
  if (!(await goneWithin(ending, withinMs, timer))) {
    ending.signal('SIGKILL');
    await ending.gone(new AbortController().signal);
  }
}

/** How a process known by its pid alone is ended: the signaller, the timer it looks on, how often and for how long. */
export interface PidEnding {
  readonly signaller: Signaller;
  readonly timer: Timer;
  readonly lookEveryMs: number;
  readonly stoppedWithinMs: number;
}

export const realPidEnding: PidEnding = { signaller: signalled, timer: realTimer, lookEveryMs, stoppedWithinMs };

export function endedWhileItRuns(
  { pid, isStillRunning }: RunningProcess,
  { signaller, timer, lookEveryMs: everyMs, stoppedWithinMs: withinMs }: PidEnding = realPidEnding,
): Promise<void> {
  const isGone = () => !isStillRunning();
  return endedWithin(
    {
      isGone,
      signal: (name) => signaller(pid, name),
      gone: (stop) => lookedForUntilGone(isGone, stop, timer, everyMs),
    },
    withinMs,
    timer,
  );
}
