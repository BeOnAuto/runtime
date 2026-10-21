import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

const command = fileURLToPath(new URL('../../../auto-runtime.ts', import.meta.url));

const relayWithShortBounds = fileURLToPath(new URL('../entries/relay-with-short-bounds.ts', import.meta.url));

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
  readonly stderrInto?: string;
}

export function homeOfTheTest(prefix: string): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => {
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function commandLineOf(
  entry: string,
  args: readonly string[],
  stderrInto: string | undefined,
): readonly [string, readonly string[]] {
  return stderrInto === undefined
    ? [process.execPath, [entry, ...args]]
    : ['/bin/sh', ['-c', 'exec "$@" 2>"$0"', stderrInto, process.execPath, entry, ...args]];
}

function spawnedEntry(
  entry: string,
  args: readonly string[],
  { home, port, settings = {}, inAGroupOfItsOwn = false, stderrInto }: RuntimeCommandPlace,
): RuntimeCommandRun {
  const child = spawnForTheTest(...commandLineOf(entry, args, stderrInto), {
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

export function spawnRuntimeCommand(args: readonly string[], place: RuntimeCommandPlace): RuntimeCommandRun {
  return spawnedEntry(command, args, place);
}

export function spawnRelayWithShortBounds(place: RuntimeCommandPlace): RuntimeCommandRun {
  return spawnedEntry(relayWithShortBounds, [], place);
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
