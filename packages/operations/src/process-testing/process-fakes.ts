import { ChildProcess } from 'node:child_process';

import type { Signaller, Timer } from './process-endings.ts';
import type { PidReader, TestFinish } from './test-processes.ts';

export const lookEveryMs = 50;

export const boundMs = 300;

/** How a fake process answers a signal: it goes some time after the one it obeys, or obeys none. */
interface Behaviour {
  readonly obeys: 'SIGTERM' | 'SIGKILL';
  readonly goesAfterMs: number;
}

interface FakeProcesses {
  readonly signaller: Signaller;
  readonly started: (behaviour: Behaviour) => number;
  readonly sent: () => readonly string[];
}

export function fakeProcesses(): FakeProcesses {
  const running = new Map<number, Behaviour>();
  const sent: string[] = [];
  return {
    signaller: (pid, signal) => {
      const behaviour = running.get(pid);
      if (behaviour === undefined) {
        return false;
      }
      if (signal === 0) {
        return true;
      }
      sent.push(signal);
      if (signal === behaviour.obeys || signal === 'SIGKILL') {
        setTimeout(() => {
          running.delete(pid);
        }, behaviour.goesAfterMs);
      }
      return true;
    },
    started: (behaviour) => {
      const pid = running.size + 1000;
      running.set(pid, behaviour);
      return pid;
    },
    sent: () => sent,
  };
}

interface Finished {
  readonly finish: TestFinish;
  readonly finished: () => Promise<void>;
}

/** A finish that keeps the ends registered with it, ended on the timer given, every 50 ms, within 300 ms. */
export function collected(signaller: Signaller, timer: Timer): Finished {
  const ends: (() => Promise<void>)[] = [];
  return {
    finish: {
      signaller,
      timer,
      lookEveryMs,
      stoppedWithinMs: boundMs,
      registered: (end) => {
        ends.push(end);
      },
    },
    finished: async () => {
      await Promise.all(ends.map((end) => end()));
    },
  };
}

/** A promise followed on the fake clock: whether it settled yet. */
export function followed(promise: Promise<void>): () => boolean {
  const state = { settled: false };
  void promise.finally(() => {
    state.settled = true;
  });
  return () => state.settled;
}

interface Reading {
  readonly answer?: { readonly pid: number; readonly fromRead: number };
  readonly stillToCome: boolean;
}

interface Counted {
  readonly reader: PidReader;
  readonly reads: () => number;
}

export function counted({ answer, stillToCome }: Reading): Counted {
  const reads = { count: 0 };
  return {
    reader: {
      read: () => {
        reads.count += 1;
        return Promise.resolve(answer !== undefined && reads.count >= answer.fromRead ? answer.pid : undefined);
      },
      stillToCome: () => stillToCome,
      readWithinMs: boundMs,
    },
    reads: () => reads.count,
  };
}

interface FakeChild {
  readonly child: ChildProcess;
  readonly sent: () => readonly string[];
  readonly exited: (itDid: boolean) => void;
}

export function aFakeChild(pid: number | undefined, obeys: 'SIGTERM' | 'SIGKILL'): FakeChild {
  const sent: string[] = [];
  const state: { exitCode: number | null; signalCode: string | null } = { exitCode: null, signalCode: null };
  const child = Object.defineProperties(new ChildProcess(), {
    pid: { value: pid },
    exitCode: { get: () => state.exitCode },
    signalCode: { get: () => state.signalCode },
    kill: {
      value: (signal: NodeJS.Signals) => {
        sent.push(signal);
        if (signal === obeys || signal === 'SIGKILL') {
          setTimeout(() => {
            state.signalCode = signal;
            child.emit('exit', null, signal);
          }, 10);
        }
        return true;
      },
    },
  });
  return {
    child,
    sent: () => sent,
    exited: (itDid) => {
      state.exitCode = itDid ? 0 : null;
      child.emit('exit', state.exitCode, null);
    },
  };
}
