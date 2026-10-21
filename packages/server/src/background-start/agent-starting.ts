import { fileURLToPath } from 'node:url';

import type { Environment } from '@on.auto/config';

import { release } from '../composition/release.ts';
import { logFileIn } from '../local-runtime/local-control.ts';
import type { Waiting } from '../local-runtime/runtime-probe.ts';
import { restartMarkIn } from '../local-runtime/runtime-restarts.ts';
import { noticesFor, startInBackgroundOf, startingLockIn } from './background-process.ts';
import type { BackgroundStarting } from './background-start.ts';

export interface AgentRelaying {
  readonly home: string;
  readonly environment: Environment;
  readonly waiting: Waiting;
}

export function reportedOnStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function startingFor({ home, environment, waiting }: AgentRelaying): BackgroundStarting {
  return {
    ...waiting,
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
    }),
  };
}
