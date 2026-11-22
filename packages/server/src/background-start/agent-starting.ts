import { fileURLToPath } from 'node:url';

import type { Environment } from '@on.auto/config';

import { release } from '../composition/release.ts';
import { logFileIn, restartMarkIn } from '../local-runtime/local-control.ts';
import type { RuntimeFetch } from '../local-runtime/runtime-probe.ts';
import { loggedTo, noticesFor, startInBackgroundOf, startingLockIn } from './background-process.ts';
import type { BackgroundStarting } from './background-start.ts';
import { Sighting } from './sighting.ts';
import { StartedRuntimes } from './started-runtimes.ts';

export interface AgentRelaying {
  readonly home: string;
  readonly environment: Environment;
  readonly fetch: RuntimeFetch;
}

export interface AgentStarting {
  readonly starting: BackgroundStarting;
  readonly sighting: Sighting;
  readonly started: StartedRuntimes;
  readonly log: (line: string) => void;
}

export function reportedOnStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** What the starting of a relay reaches outside it: the port, the lock, the notices and the start of a process. */
export type StartingReach = Omit<BackgroundStarting, 'saw' | 'remember' | 'pausing'>;

/**
 * The starting of a relay on what it reaches: it remembers what it sees on the port and the runtimes it starts, so
 * its recovery can tell a runtime it started from one it did not.
 */
export function agentStartingWith(
  reach: StartingReach,
  log: (line: string) => void,
  now?: () => number,
): AgentStarting {
  const started = new StartedRuntimes(now);
  const sighting = new Sighting((instance) => started.ended(instance));
  const starting: BackgroundStarting = {
    ...reach,
    saw: (probe) => {
      sighting.saw(probe);
    },
    remember: (runtime) => {
      started.remember(runtime);
    },
    pausing: () => started.pausing(),
  };
  return { starting, sighting, started, log };
}

export function startingFor({ home, environment, fetch }: AgentRelaying): AgentStarting {
  const log = loggedTo(home, reportedOnStderr);
  const reach: StartingReach = {
    fetch,
    version: release.version,
    logFile: logFileIn(home),
    startingLock: startingLockIn(home),
    notice: noticesFor(home, reportedOnStderr),
    restartUnderWay: restartMarkIn(home).isUnderWay,
    startInBackground: startInBackgroundOf({
      execPath: process.execPath,
      execArgv: process.execArgv,
      entry: fileURLToPath(new URL('../../auto-runtime.ts', import.meta.url)),
      home,
      environment,
      report: reportedOnStderr,
      log,
    }),
  };
  return agentStartingWith(reach, log);
}
