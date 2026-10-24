import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ModuleAddress } from '../jobs/pool-contract.ts';
import { memoryLimiter } from '../process-pool/memory-limit.ts';

export interface FakeProcesses {
  readonly module: ModuleAddress;
  readonly missing: ModuleAddress;
  readonly limiting: string;
  readonly bare: string;
  readonly limitedWith: () => string | undefined;
  readonly announced: (pid: number, event: string) => boolean;
  readonly removeLimiter: () => void;
  readonly remove: () => void;
}

const processLoop = new URL('../process-pool/process-loop.ts', import.meta.url).href;

const pending = 'new Promise(() => {})';

const fakeProcessSource = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  `import { serveProcessJobs } from '${processLoop}';`,
  'let jobs = 0;',
  'let lastJob = -1;',
  'const counted = (payload) => { jobs += 1; return { jobs, pid: process.pid, payload }; };',
  'const later = (then) => { setTimeout(then, 50); };',
  "const announce = (event) => { writeFileSync(new URL(event + '-' + process.pid, import.meta.url), ''); };",
  "const whenNudged = (then) => { process.once('SIGUSR2', then); };",
  "process.on('message', (message) => { lastJob = message?.job ?? -1; });",
  'serveProcessJobs({',
  '  echo: (payload) => counted(payload),',
  '  sleep: (ms) => new Promise((resolve) => { setTimeout(() => resolve(counted(ms)), ms); }),',
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
  "  'disconnect later': (payload) => { later(() => { process.once('disconnect', () => announce('disconnected')); process.disconnect(); setTimeout(() => {}, 5000); }); return counted(payload); },",
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
    announced: (pid, event) => existsSync(join(directory, `${event}-${pid}`)),
    removeLimiter: () => {
      rmSync(limiter);
    },
    remove: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
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
