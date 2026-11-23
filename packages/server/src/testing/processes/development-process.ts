import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Option, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import { heardUntilItExits, somethingHappened, whenHeld } from '../waiting/until.ts';

export interface DevelopmentFiles {
  readonly directory: string;
  readonly envFile: string;
  readonly localEnvFile: string;
  readonly configFile: string;
  readonly sourceDirectory: string;
  readonly serverEntry: string;
  readonly pidsFile: string;
  readonly ledgerFile: string;
}

export interface DevelopmentOptions {
  readonly environment?: Readonly<Record<string, string>>;
}

export interface Development {
  readonly files: DevelopmentFiles;
  readonly exited: Promise<unknown>;
  readonly outputClosed: Promise<unknown>;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly signal: (name: NodeJS.Signals) => void;
  readonly pid: number | undefined;
}

const runner = fileURLToPath(new URL('run-development.ts', import.meta.url));

const mainModule = fileURLToPath(new URL('../../main.ts', import.meta.url));

const pidLine = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ pid: Schema.optional(Schema.Number) })));

export function developmentFiles(envFileText = 'HOST=127.0.0.1\n'): DevelopmentFiles {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-development-'));
  const files = {
    directory,
    envFile: join(directory, 'dev.env'),
    localEnvFile: join(directory, '.env'),
    configFile: join(directory, 'auto-runtime.yaml'),
    sourceDirectory: join(directory, 'src'),
    serverEntry: join(directory, 'src', 'entry.ts'),
    pidsFile: join(directory, 'pids'),
    ledgerFile: join(directory, 'ledger.db'),
  };
  writeFileSync(files.envFile, envFileText);
  writeFileSync(files.pidsFile, '');
  mkdirSync(files.sourceDirectory);
  writeServerEntry(files);
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return files;
}

function writeServerEntry({ serverEntry }: DevelopmentFiles, source = `import '${mainModule}';\n`): void {
  writeFileSync(serverEntry, source);
}

interface Watched {
  readonly close: () => void;
}

type WatchOfAFile = (path: string, onChange: () => void) => Watched;

function isGone(failure: unknown): boolean {
  return failure instanceof Error && 'code' in failure && failure.code === 'ENOENT';
}

export function watchedUnlessGone(
  path: string,
  onChange: () => void,
  watchOfAFile: WatchOfAFile = watch,
): Watched | undefined {
  try {
    return watchOfAFile(path, onChange);
  } catch (failure) {
    if (isGone(failure)) {
      return undefined;
    }
    throw failure;
  }
}

/**
 * Tells the waiting tests of what the processes of pnpm dev write in its folder: a file made or removed (the restart
 * mark, the pids) by a watch of the folder, and each write to the ledger by a watch of its log, made again each time
 * the server opens the ledger anew. A watch of a folder does not see a file written in place.
 */
function watchedWhileItRuns(files: DevelopmentFiles): { readonly close: () => void } {
  const log = `${files.ledgerFile}-wal`;
  const watching: { log: Watched | undefined } = { log: undefined };
  const logWatched = (): void => {
    watching.log?.close();
    watching.log = watchedUnlessGone(log, somethingHappened);
  };
  const folder = watch(files.directory, { recursive: true }, (_, name) => {
    if (name === basename(log)) {
      logWatched();
    }
    somethingHappened();
  });
  logWatched();
  return {
    close: () => {
      folder.close();
      watching.log?.close();
    },
  };
}

export function startDevelopment(files: DevelopmentFiles, options: DevelopmentOptions = {}): Development {
  const setup = {
    envFiles: [files.envFile, files.localEnvFile],
    sourceDirectory: files.sourceDirectory,
    serverEntry: files.serverEntry,
    configFile: files.configFile,
    pidsFile: files.pidsFile,
    home: files.directory,
  };
  const child = spawnForTheTest(process.execPath, [runner, JSON.stringify(setup)], {
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      HOME: homedir(),
      TMPDIR: tmpdir(),
      PORT: '0',
      LEDGER_FILE: files.ledgerFile,
      DO_NOT_TRACK: '1',
      ...noConsentThroughAuto,
      ...options.environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
    somethingHappened();
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
    somethingHappened();
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  heardUntilItExits(exited);
  const outputClosed = once(child, 'close');
  const written = watchedWhileItRuns(files);
  void outputClosed.finally(written.close);
  return {
    files,
    exited,
    outputClosed,
    stdout: () => output.stdout,
    stderr: () => output.stderr,
    signal: (name) => {
      child.kill(name);
    },
    pid: child.pid,
  };
}

export function pidsOf({ files }: Development): readonly number[] {
  return readFileSync(files.pidsFile, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => Number(pidLine(line).pid));
}

export async function untilWritten(read: () => string, wanted: Readonly<RegExp>): Promise<void> {
  await whenHeld(read, (text) => text.search(wanted) !== -1);
}

const logLineOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      level: Schema.String,
      annotations: Schema.Struct({ source: Schema.optional(Schema.String) }),
    }),
  ),
);

function linesFrom({ stderr }: Development, source: string): readonly string[] {
  return stderr()
    .split('\n')
    .flatMap((line) => Option.toArray(logLineOf(line)))
    .filter((entry) => entry.annotations.source === source)
    .map(({ level, message }) => `${level} ${message}`);
}

const readyNotice = /^INFO Auto Runtime is ready\n/u;

export function runnerLines(development: Development): readonly string[] {
  return linesFrom(development, 'dev')
    .filter((line) => !readyNotice.test(line))
    .map((line) => line.replace(/^\S+ /u, ''));
}

function listeningPorts({ stdout }: Development): readonly number[] {
  return [...stdout().matchAll(/Auto Runtime listening on port (\d+)\n/gu)].map(([, port]: readonly string[]) =>
    Number(port),
  );
}

export async function untilListening(development: Development, times = 1): Promise<number> {
  const ports = await whenHeld(
    () => listeningPorts(development),
    (listening) => listening.length >= times,
  );
  return Number(ports.at(times - 1));
}
