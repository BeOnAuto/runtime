import { fileURLToPath } from 'node:url';

import type { Environment } from '@on.auto/config';

import { release } from '../composition/release.ts';
import { logFileIn } from '../local-runtime/local-control.ts';
import type { RuntimeFetch } from '../local-runtime/runtime-probe.ts';
import { restartMarkIn } from '../local-runtime/runtime-restarts.ts';
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

export function startingFor({ home, environment, fetch }: AgentRelaying): AgentStarting {
  const started = new StartedRuntimes();
  const sighting = new Sighting((instance) => started.ended(instance));
  const log = loggedTo(home, reportedOnStderr);
  const starting: BackgroundStarting = {
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
