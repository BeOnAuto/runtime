import { join } from 'node:path';

import type { RuntimeAction, RuntimeStatus, StartedBy } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import type { AccessMode } from '@on.auto/identity';

import type { LocalServing } from '../lifecycle/lifecycle.ts';
import type { RunsInFlight } from './runs-in-flight.ts';
import type { RestartMark } from './runtime-restarts.ts';

export const defaultRuntimePort = 5555;

export interface LocalRun {
  readonly version: string;
  readonly pid: number;
  readonly instance: string;
  readonly startedAt: Date;
  readonly directory: string;
  readonly home: string;
  readonly startedBy: StartedBy;
  readonly port: string | undefined;
}

export interface LocalStarting {
  readonly startedBy: StartedBy;
  readonly instance: string;
}

export interface LocalControl {
  readonly servingIn: (mode: AccessMode) => LocalServing;
  readonly asked: Promise<RuntimeAction>;
}

export function runtimeHomeIn(home: string): string {
  return join(home, '.auto-runtime');
}

export function logFileIn(home: string): string {
  return join(runtimeHomeIn(home), 'runtime.log');
}

function portServedBy({ port }: Pick<LocalRun, 'port'>): number {
  return port === undefined ? defaultRuntimePort : Number(port);
}

export function restartWordsFor(run: Pick<LocalRun, 'port' | 'version'>): string {
  const command = `${run.port === undefined ? '' : `PORT=${run.port} `}npx -y @on.auto/runtime@${run.version} restart`;
  return `restart Auto Runtime with ${command} or at http://localhost:${portServedBy(run)}`;
}

export function providerSetupFor(directory: string, restart = 'restart Auto Runtime'): string {
  return [
    `To add one, ask the person to put a line such as ANTHROPIC_API_KEY=<their key> in ${join(directory, '.env')}, never in this chat,`,
    `then ${restart}.`,
    'Then offer a first function, as the first-playbook recipe of get_guide does; on.auto/docs has more.',
  ].join(' ');
}

export function runtimeStatusOf(run: LocalRun, runsInFlight: number): RuntimeStatus {
  return {
    version: run.version,
    pid: run.pid,
    instance: run.instance,
    startedAt: run.startedAt,
    directory: run.directory,
    startedBy: run.startedBy,
    logFile: run.startedBy === 'agent' ? logFileIn(run.home) : undefined,
    runsInFlight,
  };
}

export function localControlOf(
  run: LocalRun,
  runs: RunsInFlight,
  restartMark: Pick<RestartMark, 'leave'>,
): LocalControl {
  const { promise, resolve } = Promise.withResolvers<RuntimeAction>();
  const runtimeControl = {
    status: () => runtimeStatusOf(run, runs.count()),
    stop: () => {
      resolve('stop');
    },
    restart: () => {
      restartMark.leave(run.pid, portServedBy(run));
      resolve('restart');
    },
  };
  return {
    servingIn: (mode) =>
      mode === 'local'
        ? { runtimeControl, providerSetup: providerSetupFor(run.directory, restartWordsFor(run)), appended: runs }
        : { providerSetup: providerSetupFor(run.directory) },
    asked: promise,
  };
}

type Execve = (file: string, args?: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => never;

export interface RestartingProcess {
  readonly execPath: string;
  readonly execArgv: readonly string[];
  readonly argv: readonly string[];
  readonly execve?: Execve | undefined;
  readonly stderr: { write(text: string): unknown };
}

export function restartIn(running: RestartingProcess, environment: Environment): void {
  if (running.execve === undefined) {
    running.stderr.write('Auto Runtime restarts only on macOS and Linux, so it has stopped instead\n');
    return;
  }
  running.execve(running.execPath, [running.execPath, ...running.execArgv, ...running.argv.slice(1)], environment);
}
