import { once } from 'node:events';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { endWithTheTest, spawnForTheTest } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

import { runtimeHomeIn } from '../../local-runtime/local-control.ts';
import { overTheNetwork, probeAt } from '../../local-runtime/runtime-probe.ts';

const command = fileURLToPath(new URL('../../../auto-runtime.ts', import.meta.url));

export interface RuntimeCommandRun {
  readonly pid: number | undefined;
  readonly write: (text: string) => void;
  readonly end: () => void;
  readonly killGroup: () => void;
  readonly interrupt: () => void;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exited: Promise<unknown>;
}

export interface RuntimeCommandPlace {
  readonly home: string;
  readonly port: number;
  readonly settings?: Readonly<Record<string, string>>;
  readonly inAGroupOfItsOwn?: boolean;
}

export interface RuntimeOnThePort {
  readonly pid: () => Promise<number>;
}

const startedRuntimeReadWithinMs = 30_000;

const answeredEveryMs = 50;

function isInside(home: string, directory: string): boolean {
  return directory === home || directory.startsWith(`${home}${sep}`);
}

async function pidOfTheHomeAnsweringOn(home: string, port: number): Promise<number | undefined> {
  const probe = await probeAt(port, overTheNetwork);
  return probe.state === 'running' && isInside(home, probe.status.directory) ? probe.status.pid : undefined;
}

async function pidOnceAnswering(home: string, port: number, polling: AbortSignal): Promise<number> {
  const pid = await pidOfTheHomeAnsweringOn(home, port);
  if (pid !== undefined) {
    return pid;
  }
  polling.throwIfAborted();
  await setTimeout(answeredEveryMs);
  return pidOnceAnswering(home, port, polling);
}

export function runtimeOnThePortEndedWithTheTest(home: string, port: number): RuntimeOnThePort {
  const polling = new AbortController();
  endWithTheTest({
    read: () => pidOfTheHomeAnsweringOn(home, port),
    stillToCome: () => existsSync(join(runtimeHomeIn(home), 'starting.lock')),
    readWithinMs: startedRuntimeReadWithinMs,
  });
  onTestFinished(() => {
    polling.abort();
  });
  return { pid: () => pidOnceAnswering(home, port, polling.signal) };
}

export function homeOfTheTest(prefix: string): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => {
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

export function spawnRuntimeCommand(
  args: readonly string[],
  { home, port, settings = {}, inAGroupOfItsOwn = false }: RuntimeCommandPlace,
): RuntimeCommandRun {
  const child = spawnForTheTest(process.execPath, [command, ...args], {
    detached: inAGroupOfItsOwn,
    cwd: home,
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      PATH: process.env['PATH'],
      HOME: home,
      PORT: String(port),
      DO_NOT_TRACK: '1',
      AUTO_CLIENTS: 'false',
      ...settings,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  return {
    pid: child.pid,
    write: (text) => {
      child.stdin?.write(text);
    },
    end: () => {
      child.stdin?.end();
    },
    killGroup: () => {
      process.kill(-Number(child.pid), 'SIGKILL');
    },
    interrupt: () => {
      child.kill('SIGINT');
    },
    stdout: () => output.stdout,
    stderr: () => output.stderr,
    exited: once(child, 'exit').then(([code]: readonly unknown[]) => code),
  };
}

export async function ranToEnd(
  args: readonly string[],
  place: RuntimeCommandPlace,
): Promise<{ readonly code: unknown; readonly stdout: string }> {
  const run = spawnRuntimeCommand(args, place);
  run.end();
  const code = await run.exited;
  return { code, stdout: run.stdout() };
}
