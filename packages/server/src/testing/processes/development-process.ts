import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Option, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { until } from '../waiting/until.ts';

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

export function writeServerEntry({ serverEntry }: DevelopmentFiles, source = `import '${mainModule}';\n`): void {
  writeFileSync(serverEntry, source);
}

export function startDevelopment(files: DevelopmentFiles, options: DevelopmentOptions = {}): Development {
  const setup = {
    envFiles: [files.envFile, files.localEnvFile],
    sourceDirectory: files.sourceDirectory,
    serverEntry: files.serverEntry,
    configFile: files.configFile,
    pidsFile: files.pidsFile,
  };
  const child = spawnForTheTest(process.execPath, [runner, JSON.stringify(setup)], {
    env: {
      NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      HOME: homedir(),
      TMPDIR: tmpdir(),
      PORT: '0',
      LEDGER_FILE: files.ledgerFile,
      PREDICTION_CACHE_DIR: join(files.directory, 'prediction-cache'),
      DO_NOT_TRACK: '1',
      ...options.environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.stderr += chunk;
  });
  const exited = once(child, 'exit').then(([code]: readonly unknown[]) => code);
  const outputClosed = once(child, 'close');
  return {
    files,
    exited,
    outputClosed,
    stdout: () => output.stdout,
    stderr: () => output.stderr,
    signal: (name) => {
      child.kill(name);
    },
  };
}

export function pidsOf({ files }: Development): readonly number[] {
  return readFileSync(files.pidsFile, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => Number(pidLine(line).pid));
}

export async function untilWritten(read: () => string, wanted: Readonly<RegExp>): Promise<void> {
  await until(read, (text) => text.search(wanted) !== -1);
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

export function readyNoticesOf(development: Development): readonly string[] {
  return linesFrom(development, 'dev')
    .filter((line) => readyNotice.test(line))
    .map((line) => line.replace(readyNotice, ''));
}

function listeningPorts({ stdout }: Development): readonly number[] {
  return [...stdout().matchAll(/Auto Runtime listening on port (\d+)\n/gu)].map(([, port]: readonly string[]) =>
    Number(port),
  );
}

export async function untilListening(development: Development, times = 1): Promise<number> {
  const ports = await until(
    () => listeningPorts(development),
    (listening) => listening.length >= times,
  );
  return Number(ports.at(times - 1));
}
