import { sightingsOfARelay, type BackgroundStarting } from '../../local-runtime/background-start.ts';
import type { RunningStatus, RuntimeFetch } from '../../local-runtime/runtime-probe.ts';

export const startedForAnAgent: RunningStatus = {
  version: '0.9.1',
  pid: 4242,
  started_at: '2026-10-14T09:41:07.000Z',
  started_by: 'agent',
  directory: '/Users/ada/.auto-runtime',
  log_file: '/Users/ada/.auto-runtime/runtime.log',
  runs_in_flight: 0,
};

export type Answering = object | 'hangs' | 'guards' | undefined;

export interface Computer {
  readonly answering: () => Answering;
  readonly answerWith: (answer?: Answering) => void;
  readonly record: (event: string) => void;
  readonly events: () => readonly string[];
}

export function computerWith(first?: Answering): Computer {
  let answering = first;
  const events: string[] = [];
  return {
    answering: () => answering,
    answerWith: (answer) => {
      answering = answer;
    },
    record: (event) => {
      events.push(event);
    },
    events: () => [...events],
  };
}

const timedOut = new DOMException('The operation was aborted due to timeout', 'TimeoutError');

function guarding(address: string): Response {
  return address.endsWith('/health')
    ? Response.json({ status: 'ok' })
    : Response.json({ type: 'https://on.auto/problems/unauthenticated' }, { status: 401 });
}

function fetchOn(computer: Computer): RuntimeFetch {
  return (address, { method }) => {
    const answering = computer.answering();
    if (answering === undefined) {
      return Promise.reject(new TypeError('fetch failed'));
    }
    if (answering === 'hangs') {
      return Promise.reject(timedOut);
    }
    if (answering === 'guards') {
      return Promise.resolve(guarding(address));
    }
    if (method === 'POST') {
      computer.record(`asked ${address.slice(address.lastIndexOf('/') + 1)}`);
      computer.answerWith();
      return Promise.resolve(Response.json({ status: 'stopping' }, { status: 202 }));
    }
    return Promise.resolve(Response.json(answering));
  };
}

export interface Options {
  readonly version?: string;
  readonly startsAs?: Answering;
  readonly comesBackAfter?: number;
  readonly lockTaken?: boolean;
  readonly restarting?: boolean;
  readonly sawBefore?: RunningStatus;
  readonly outlivesSigterm?: boolean;
}

export interface Starting extends BackgroundStarting {
  readonly naps: () => number;
}

function processesOn(computer: Computer, options: Options): BackgroundStarting['processes'] {
  let alive = true;
  return {
    signal: (pid, signal) => {
      computer.record(`${signal} ${pid}`);
      if (signal === 'SIGKILL' || options.outlivesSigterm !== true) {
        alive = false;
        computer.answerWith();
      }
      return true;
    },
    alive: () => alive,
  };
}

function sightingsBefore(options: Options): BackgroundStarting['sightings'] {
  const sightings = sightingsOfARelay();
  if (options.sawBefore !== undefined) {
    sightings.saw(options.sawBefore);
  }
  return sightings;
}

export function startingOn(computer: Computer, options: Options = {}): Starting {
  let sleeps = 0;
  return {
    version: options.version ?? '0.9.1',
    logFile: '/Users/ada/.auto-runtime/runtime.log',
    fetch: fetchOn(computer),
    sleep: () => {
      sleeps += 1;
      if (options.comesBackAfter === sleeps) {
        computer.answerWith(startedForAnAgent);
      }
      return Promise.resolve();
    },
    naps: () => sleeps,
    startInBackground: () => {
      computer.record('started');
      computer.answerWith('startsAs' in options ? options.startsAs : startedForAnAgent);
    },
    startingLock: {
      take: () => {
        computer.record('locked');
        return options.lockTaken !== true;
      },
      release: () => {
        computer.record('unlocked');
      },
    },
    notice: (line) => {
      computer.record(`noticed ${line}`);
    },
    restartUnderWay: () => options.restarting === true,
    processes: processesOn(computer, options),
    sightings: sightingsBefore(options),
  };
}
