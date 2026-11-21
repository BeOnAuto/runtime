import { ChildProcess } from 'node:child_process';
import { subscribe } from 'node:diagnostics_channel';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Function, Schema } from 'effect';

import type { ModuleAddress } from '../jobs/pool-contract.ts';
import { memoryLimiter } from '../process-pool/memory-limit.ts';

export interface FakeProcesses {
  readonly module: ModuleAddress;
  readonly missing: ModuleAddress;
  readonly limiting: string;
  readonly bare: string;
  readonly limitedWith: () => string | undefined;
  readonly announced: (pid: number, event: string) => Promise<void>;
  readonly removeLimiter: () => void;
  readonly remove: () => void;
}

const processLoop = new URL('../process-pool/process-loop.ts', import.meta.url).href;

const pending = 'new Promise(() => {})';

const fakeProcessSource = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "import { MessageChannel } from 'node:worker_threads';",
  `import { serveProcessJobs } from '${processLoop}';`,
  'let jobs = 0;',
  'let lastJob = -1;',
  'const counted = (payload) => { jobs += 1; return { jobs, pid: process.pid, payload }; };',
  "const announce = (event) => { writeFileSync(new URL(event + '-' + process.pid, import.meta.url), ''); };",
  "const whenNudged = (then) => { process.once('SIGUSR2', then); };",
  "const keptAlive = () => { new MessageChannel().port1.on('message', () => {}); };",
  "process.on('message', (message) => { lastJob = message?.job ?? -1; });",
  'serveProcessJobs({',
  '  echo: (payload) => counted(payload),',
  "  hold: (payload) => new Promise((resolve) => { whenNudged(() => resolve(counted(payload))); announce('began'); }),",
  `  'begin and wait': () => { announce('began'); return ${pending}; },`,
  "  block: () => { announce('began'); for (;;) {} },",
  '  allocate: (mebibytes) => { const chunks = []; while (chunks.length * 32 < mebibytes) chunks.push(new Uint8Array(33554432).fill(1)); return chunks.length; },',
  '  exit: (code) => process.exit(code),',
  '  abort: () => process.abort(),',
  `  terminate: () => { process.kill(process.pid, 'SIGTERM'); return ${pending}; },`,
  "  'fail to allocate': () => { throw new RangeError('Array buffer allocation failed'); },",
  '  throw: (message) => { throw new Error(message); },',
  '  environment: () => Object.keys(process.env),',
  "  limits: () => ({ pid: process.pid, limits: readFileSync('/proc/self/limits', 'utf8').split('\\n').filter((line) => /^Max (?:data|core file) size/u.test(line)) }),",
  '  typed: (payload) => ({ given: payload, doubled: Float64Array.from(payload.values, (each) => each * 2), bytes: new Uint8Array([1, 2, 255]) }),',
  "  stray: (payload) => { whenNudged(() => process.send('stray')); return counted(payload); },",
  "  'then exit': (payload) => { whenNudged(() => process.exit(0)); return counted(payload); },",
  "  'disconnect when nudged': (payload) => { whenNudged(() => { process.once('disconnect', () => announce('disconnected')); keptAlive(); process.disconnect(); }); return counted(payload); },",
  `  'wrong job': () => { process.send({ job: lastJob + 1, answer: 1, keep: true }); return ${pending}; },`,
  `  garbage: () => { process.send({ nonsense: true }); return ${pending}; },`,
  `  undecodable: () => { process.send({ job: lastJob, answer: { $typed: 'Nope', base64: 'AA==' }, keep: true }); return ${pending}; },`,
  '}, process);',
].join('\n');

const fakeLimiterSource = [
  '#!/bin/sh',
  'printf \'%s %s\\n\' "$1" "$2" > "${0%/*}/limited"',
  'shift 2',
  'exec "$@"',
].join('\n');

export function fakeProcesses(): FakeProcesses {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-processes-'));
  const limiting = join(directory, 'limiting');
  const bare = join(directory, 'bare');
  const module = join(directory, 'fake-process.mjs');
  const limiter = join(limiting, memoryLimiter);
  const limited = join(limiting, 'limited');
  mkdirSync(limiting);
  mkdirSync(bare);
  writeFileSync(module, fakeProcessSource);
  writeFileSync(limiter, fakeLimiterSource);
  chmodSync(limiter, 0o755);
  return {
    module: () => pathToFileURL(module),
    missing: () => pathToFileURL(join(directory, 'no-such-module.mjs')),
    limiting,
    bare,
    limitedWith: () => (existsSync(limited) ? readFileSync(limited, 'utf8').trim() : undefined),
    announced: (pid, event) => written(directory, `${event}-${pid}`),
    removeLimiter: () => {
      rmSync(limiter);
    },
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function written(directory: string, name: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const file = join(directory, name);
  const looked = (): void => {
    if (existsSync(file)) {
      watcher.close();
      resolve();
    }
  };
  const watcher = watch(directory, looked);
  looked();
  return promise;
}

interface Spawned {
  readonly pid: () => number | undefined;
  readonly exited: Promise<void>;
}

const decodeSpawned = Schema.decodeUnknownSync(Schema.Struct({ process: Schema.instanceOf(ChildProcess) }));

const spawned: Spawned[] = [];

subscribe('child_process', (message) => {
  const child = decodeSpawned(message).process;
  spawned.push({ pid: () => child.pid, exited: once(child, 'exit').then(Function.constVoid, Function.constVoid) });
});

/**
 * Resolves once the process the pool started with this pid has exited. The pool hears the exit in the same turn,
 * before this resolves, since this listener only queues the resolution.
 */
export async function exitOf(pid: number): Promise<void> {
  await Promise.all(spawned.filter((each) => each.pid() === pid).map(({ exited }) => exited));
}

export function nudge(pid: number): void {
  process.kill(pid, 'SIGUSR2');
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
