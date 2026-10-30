import { spawn } from 'node:child_process';

import type { Environment } from '@on.auto/config';

export type Written = (text: string) => void;

export interface ChildCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Environment;
  readonly stdin: 'ignore' | 'pipe';
  readonly stdout: 'ignore' | Written;
  readonly stderr: 'inherit';
}

interface ChildHandle {
  readonly pid: number | undefined;
  readonly ended: Promise<string>;
  readonly kill: (name: NodeJS.Signals) => boolean;
}

export interface RunningChild {
  readonly pid: number | undefined;
  readonly ended: Promise<string>;
  readonly signal: (name: NodeJS.Signals) => boolean;
  readonly stop: (name: NodeJS.Signals) => Promise<string>;
}

export type SpawnChild = (command: ChildCommand) => ChildHandle;

export type StartChild = (command: ChildCommand) => RunningChild;

function endingOf(code: number | null, signal: NodeJS.Signals | null): string {
  return code === null ? `signal ${String(signal)}` : `exit code ${code}`;
}

function streamOf(output: 'ignore' | Written): 'ignore' | 'pipe' {
  return typeof output === 'function' ? 'pipe' : output;
}

function spawned({ command, args, environment, stdin, stdout, stderr }: ChildCommand): ChildHandle {
  const child = spawn(command, args, {
    detached: true,
    env: { ...environment },
    stdio: [stdin, streamOf(stdout), stderr],
  });
  const { promise: ended, resolve: end } = Promise.withResolvers<string>();
  child.once('exit', (code, signal) => {
    end(endingOf(code, signal));
  });
  child.once('error', (error: unknown) => {
    end(String(error));
  });
  if (typeof stdout === 'function') {
    child.stdout?.setEncoding('utf8').on('data', stdout);
  }
  return { pid: child.pid, ended, kill: (name) => child.kill(name) };
}

export function startChild(command: ChildCommand, spawnChild: SpawnChild = spawned): RunningChild {
  const child = spawnChild(command);
  return {
    pid: child.pid,
    ended: child.ended,
    signal: child.kill,
    stop: (name) => {
      child.kill(name);
      return child.ended;
    },
  };
}
