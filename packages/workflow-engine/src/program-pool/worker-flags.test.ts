import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import { programPool } from './program-pool.ts';

const reading = new URL(
  `data:text/javascript,${encodeURIComponent(
    [
      "import { parentPort } from 'node:worker_threads';",
      "parentPort.on('message', ({ job }) => {",
      '  const output = JSON.stringify({ environment: Object.keys(process.env), flags: process.execArgv, preloaded: globalThis.preloaded === true });',
      "  parentPort.postMessage({ job, answer: { ran: 'answered', output, bytes: output.length, work: 0 }, keep: true });",
      '});',
    ].join('\n'),
  )}`,
);

const request: ProgramRequest = {
  source: '.',
  entry: 'default',
  arguments: [null],
  moment: 0,
  budget: 500,
  memoryBytes: 67_108_864,
  stackBytes: 1_048_576,
  deadlineMs: 10_000,
  mostOutputBytes: 1000,
};

function poolReading(environment?: Readonly<Record<string, string>>): ProgramPool {
  const pool = programPool({
    handed: { sandbox: {} },
    instances: 'fresh',
    workers: 1,
    heapMegabytes: 64,
    worker: reading,
    ...(environment === undefined ? {} : { environment }),
  });
  onTestFinished(() => pool.close());
  return pool;
}

const server = [
  `const { programPool } = await import(${JSON.stringify(new URL('program-pool.ts', import.meta.url).href)});`,
  `const pool = programPool({ handed: { sandbox: {} }, instances: 'fresh', workers: 1, heapMegabytes: 64, worker: new URL(${JSON.stringify(reading.href)}) });`,
  "const outcome = await pool.run({ source: '.', arguments: [null], entry: 'default', moment: 0, budget: 500, memoryBytes: 67108864, stackBytes: 1048576, deadlineMs: 10000, mostOutputBytes: 1000 });",
  'await pool.close();',
  'process.stdout.write(JSON.stringify({ secret: process.env.WORKER_SECRET, preloaded: globalThis.preloaded === true, outcome }));',
].join('\n');

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'worker-flags-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

async function printedBy(nodeArguments: readonly string[]): Promise<string> {
  const child = spawnForTheTest(process.execPath, nodeArguments, { stdio: ['ignore', 'pipe', 'inherit'] });
  const printed = { text: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
  });
  await once(child, 'close');
  return printed.text;
}

describe('the flags of a worker', () => {
  it("are none of the server's, so neither the env file nor the preload the server started with reaches a program's worker", async () => {
    const directory = temporaryDirectory();
    const envFile = join(directory, 'server.env');
    const preload = join(directory, 'preload.mjs');
    writeFileSync(envFile, 'WORKER_SECRET=x\n');
    writeFileSync(preload, 'globalThis.preloaded = true;\n');

    const printed = await printedBy([
      `--env-file=${envFile}`,
      `--import=${pathToFileURL(preload).href}`,
      '--eval',
      server,
    ]);

    expect(JSON.parse(printed)).toMatchObject({
      secret: 'x',
      preloaded: true,
      outcome: { ran: 'answered', output: { environment: [], flags: [], preloaded: false } },
    });
  });
});

describe('the environment of a worker', () => {
  it('is empty unless the pool is given one, so no setting of the server, such as a key, reaches a program or its worker', async () => {
    expect(Object.keys(process.env).length).toBeGreaterThan(1);
    expect(await poolReading().run(request)).toMatchObject({ ran: 'answered', output: { environment: [] } });
    expect(await poolReading({ ONLY: 'this' }).run(request)).toMatchObject({ output: { environment: ['ONLY'] } });
  });
});
