import { fileURLToPath } from 'node:url';

import { endWithTheTest } from '@on.auto/operations/testing';
import { Function } from 'effect';

import { startInBackgroundOf } from '../../background-start/background-process.ts';
import type { StartedRuntime } from '../../background-start/started-runtimes.ts';
import { aLineToTheTest } from './lines-to-the-test.ts';
import { homeOfTheTest } from './runtime-command.ts';

const ignoringEntry = fileURLToPath(new URL('../entries/ignore-sigterm.ts', import.meta.url));

export interface StubbornRuntime {
  readonly started: StartedRuntime;
  /** Answers once the runtime said it was sent SIGTERM, which it does not end on. */
  readonly askedToStop: () => Promise<void>;
}

/** A real process, started in the background as the relay starts a runtime, which does not end on SIGTERM. */
export async function aStartedRuntimeThatIgnoresSigterm(): Promise<StubbornRuntime> {
  const line = await aLineToTheTest();
  const started = startInBackgroundOf({
    execPath: process.execPath,
    execArgv: [],
    entry: ignoringEntry,
    home: homeOfTheTest('auto-runtime-stubborn-'),
    environment: { PATH: process.env['PATH'], NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'], ...line.environment },
    report: Function.constVoid,
    log: Function.constVoid,
  })();
  endWithTheTest(Number(started.pid));
  await line.said('started', started.ended);
  return { started, askedToStop: () => line.said('sigterm', started.ended) };
}
