import { fileURLToPath } from 'node:url';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Environment } from '@on.auto/config';

import { release } from '../composition/release.ts';
import {
  noticesFor,
  processesOfThisComputer,
  restartMarkIn,
  startInBackgroundOf,
  startingLockIn,
} from './background-process.ts';
import { briefly, impatient, runningRuntime, sightingsOfARelay } from './background-start.ts';
import { logFileIn } from './local-control.ts';
import { relay, type Timer } from './mcp-relay.ts';
import { isAnswering, probeAt, runtimeAddressOf, type Waiting } from './runtime-probe.ts';

export interface AgentRelaying {
  readonly home: string;
  readonly environment: Environment;
  readonly waiting: Waiting;
}

function report(line: string): void {
  process.stderr.write(`${line}\n`);
}

const timer: Timer = (milliseconds, then) => {
  const timeout = setTimeout(then, milliseconds);
  timeout.unref();
  return () => {
    clearTimeout(timeout);
  };
};

export async function relayedAgent(port: number, { home, environment, waiting }: AgentRelaying): Promise<void> {
  const starting = {
    ...waiting,
    version: release.version,
    logFile: logFileIn(home),
    startingLock: startingLockIn(home),
    notice: noticesFor(home, report),
    restartUnderWay: restartMarkIn(home).isUnderWay,
    processes: processesOfThisComputer,
    sightings: sightingsOfARelay(),
    startInBackground: startInBackgroundOf({
      execPath: process.execPath,
      execArgv: process.execArgv,
      entry: fileURLToPath(new URL('../../auto-runtime.ts', import.meta.url)),
      home,
      environment,
      report,
    }),
  };
  const notRunning = await runningRuntime(port, starting, impatient);
  if (notRunning !== undefined) {
    report(notRunning);
  }
  await relay({
    agent: () => new StdioServerTransport(),
    runtime: () => new StreamableHTTPClientTransport(new URL(`${runtimeAddressOf(port)}/mcp`)),
    recover: () => runningRuntime(port, starting, briefly),
    answering: async () => isAnswering(await probeAt(port, waiting.fetch)),
    timer,
    report,
  });
}
