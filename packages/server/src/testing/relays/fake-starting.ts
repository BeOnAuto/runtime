import { Effect, Function } from 'effect';

import type { BackgroundStarting } from '../../background-start/background-start.ts';
import type { StartedRuntime } from '../../background-start/started-runtimes.ts';
import { probeEveryMs, type RuntimeFetch } from '../../local-runtime/runtime-probe.ts';
import { after } from './relayed-agent.ts';

export const startedForAnAgent = {
  version: '0.9.1',
  pid: 4242,
  started_at: '2026-10-14T09:41:07.000Z',
  started_by: 'agent',
  directory: '/Users/ada/.auto-runtime',
  log_file: '/Users/ada/.auto-runtime/runtime.log',
  runs_in_flight: 0,
};

export interface Computer {
  readonly answering: () => object | undefined;
  readonly answerWith: (answer?: object) => void;
  readonly record: (event: string) => void;
  readonly events: () => readonly string[];
  readonly sight: (state: string) => void;
  readonly sightings: () => readonly string[];
  readonly probed: () => void;
  readonly probes: () => number;
  readonly freeze: () => void;
  readonly frozen: () => boolean;
  readonly aborted: () => void;
  readonly aborts: () => number;
}

export function computerWith(first?: object): Computer {
  let answering = first;
  let probes = 0;
  let frozen = false;
  let aborts = 0;
  const events: string[] = [];
  const sightings: string[] = [];
  return {
    answering: () => answering,
    answerWith: (answer) => {
      answering = answer;
    },
    record: (event) => {
      events.push(event);
    },
    events: () => [...events],
    sight: (state) => {
      sightings.push(state);
    },
    sightings: () => [...sightings],
    probed: () => {
      probes += 1;
    },
    probes: () => probes,
    freeze: () => {
      frozen = true;
    },
    frozen: () => frozen,
    aborted: () => {
      aborts += 1;
    },
    aborts: () => aborts,
  };
}

function unansweredUntilAborted(computer: Computer, signal: Readonly<AbortSignal>): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        computer.aborted();
        reject(new DOMException('This operation was aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function answerOf(computer: Computer, address: string, method: 'GET' | 'POST'): Promise<Response> {
  const answering = computer.answering();
  if (answering === undefined) {
    return Promise.reject(new TypeError('fetch failed'));
  }
  if (method === 'POST') {
    computer.record(`asked ${address.slice(address.lastIndexOf('/') + 1)}`);
    computer.answerWith();
    return Promise.resolve(Response.json({ status: 'stopping' }, { status: 202 }));
  }
  return Promise.resolve(Response.json(answering));
}

function isAProbe(address: string, method: 'GET' | 'POST'): boolean {
  return method === 'GET' && address.endsWith('/runtime');
}

function fetchOn(computer: Computer, comesBackAfter: number | undefined): RuntimeFetch {
  return (address, { method, signal }) => {
    const answer = computer.frozen() ? unansweredUntilAborted(computer, signal) : answerOf(computer, address, method);
    if (isAProbe(address, method)) {
      computer.probed();
      if (computer.probes() === comesBackAfter) {
        computer.answerWith(startedForAnAgent);
      }
    }
    return answer;
  };
}

export interface Options {
  readonly version?: string;
  readonly startsAs?: object | undefined;
  readonly startsFrozen?: boolean;
  readonly comesBackAfter?: number;
  readonly lockTaken?: boolean;
  readonly restarting?: boolean;
  readonly endsAtItsStart?: boolean;
  readonly pausing?: boolean;
}

function startedRuntime(endsAtItsStart: boolean): StartedRuntime {
  return {
    instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    pid: 4343,
    startedAt: 0,
    endedAt: () => (endsAtItsStart ? 1 : undefined),
    signal: Function.constTrue,
    ended: Promise.resolve(),
  };
}

export function startingOn(computer: Computer, options: Options = {}): BackgroundStarting {
  return {
    version: options.version ?? '0.9.1',
    logFile: '/Users/ada/.auto-runtime/runtime.log',
    fetch: fetchOn(computer, options.comesBackAfter),
    startInBackground: () => {
      computer.record('started');
      computer.answerWith('startsAs' in options ? options.startsAs : startedForAnAgent);
      if (options.startsFrozen === true) {
        computer.freeze();
      }
      return startedRuntime(options.endsAtItsStart === true);
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
    saw: (probe) => {
      computer.sight(probe.state);
    },
    remember: ({ pid }) => {
      computer.sight(`remembered ${String(pid)}`);
    },
    pausing: () => options.pausing === true,
  };
}

export function ranProbeByProbe<A>(program: Effect.Effect<A>): Effect.Effect<A> {
  return Effect.race(program, Effect.forever(after(probeEveryMs)));
}
