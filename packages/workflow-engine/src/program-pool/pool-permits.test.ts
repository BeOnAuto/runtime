import { once } from 'node:events';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { PoolOutcome, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { begun, counting, countingElsewhere } from '../pool-testing/counting-workers.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { threadsAlive } from '../pool-testing/threads-alive.ts';
import { unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { programPool } from './program-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly thread: number;
}

const pools: ProgramPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }));

async function executed(script: string): Promise<string> {
  const child = spawnForTheTest(process.execPath, ['--eval', script], {
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 20_000,
  });
  const printed = { text: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    printed.text += chunk;
  });
  const ended: readonly unknown[] = await once(child, 'close');
  expect(ended).toEqual([0, null]);
  return printed.text;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(4), ...settings });
  pools.push(pool);
  return pool;
}

function run(
  pool: ProgramPool,
  source: string,
  worker: Readonly<URL> = counting,
  deadlineMs = 10_000,
): Promise<PoolOutcome> {
  return pool.run({
    source,
    entry: 'default',
    arguments: [null],
    moment: 0,
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    deadlineMs,
    mostOutputBytes: 1000,
    worker,
  });
}

function ranOf(outcome: PoolOutcome): Ran {
  return decodeRan(outcome.ran === 'answered' ? outcome.output : {});
}

async function counted(pool: ProgramPool, worker: Readonly<URL> = counting): Promise<Ran> {
  return ranOf(await run(pool, 'count', worker));
}

async function held(pool: ProgramPool, jobs: number): Promise<readonly number[]> {
  const outcomes = await Promise.all(Array.from({ length: jobs }, () => run(pool, 'hold')));
  return outcomes.map((outcome) => ranOf(outcome).thread);
}

describe('the workers of a pool and its permits', () => {
  it('starts the worker of another module only once it has let go of the oldest idle one, so the threads alive never exceed the permits', async () => {
    const before = threadsAlive();
    const pool = poolOf();

    const four = await held(pool, 4);
    const fullOfIdle = threadsAlive() - before;
    const elsewhere = await counted(pool, countingElsewhere);
    const afterTheOther = threadsAlive() - before;
    const beginning = begun(4);
    const holding = held(pool, 4);
    await beginning;
    const whileHolding = threadsAlive() - before;
    const again = await holding;

    expect(new Set(four).size).toBe(4);
    expect([fullOfIdle, afterTheOther]).toEqual([4, 4]);
    expect(whileHolding).toBeLessThanOrEqual(4);
    expect(four).not.toContain(elsewhere.thread);
    expect(again.filter((thread) => four.includes(thread))).toHaveLength(3);
  });

  it('starts two jobs of another module at once on a pool full of idle workers once each has let go of one', async () => {
    const before = threadsAlive();
    const pool = poolOf({ workers: 2 });
    await held(pool, 2);

    const both = await Promise.all([counted(pool, countingElsewhere), counted(pool, countingElsewhere)]);

    expect(both.map(({ jobs }) => jobs)).toEqual([1, 1]);
    expect(threadsAlive() - before).toBe(2);
  });
});

describe('the workers of a pool and its permits, while a worker is let go of', () => {
  it('starts two jobs at once against a worker still dying only once it has gone, so the threads alive never exceed the permits', async () => {
    const before = threadsAlive();
    const pool = poolOf({ workers: 2 });
    await Promise.all([run(pool, 'count'), run(pool, 'linger')]);

    const beginning = begun(2);
    const both = Promise.all([
      run(pool, 'hold', countingElsewhere, 20_000),
      run(pool, 'hold', countingElsewhere, 20_000),
    ]);
    await beginning;
    const whileTheLastDies = threadsAlive() - before;
    const answered = await both;

    expect(whileTheLastDies).toBeLessThanOrEqual(2);
    expect(answered.map(({ ran }) => ran)).toEqual(['answered', 'answered']);
    expect(answered.map((outcome) => ranOf(outcome).jobs)).toEqual([1, 1]);
  });

  it('ends as closing the jobs that wait for a worker to be let go of when the pool closes', async () => {
    const pool = poolOf({ workers: 2 });
    await held(pool, 2);

    const waiting = [run(pool, 'count', countingElsewhere), run(pool, 'count', countingElsewhere)];
    await pool.close();

    expect(await Promise.all(waiting)).toMatchObject([
      { ran: 'stopped', because: 'closing' },
      { ran: 'stopped', because: 'closing' },
    ]);
  });
});

describe('the deadline of a warm worker', () => {
  it('terminates a warm worker blocked past its deadline, and the jobs after it go to the worker left and a fresh one', async () => {
    const pool = poolOf({ workers: 2 });
    const warm = await Promise.all([counted(pool), counted(pool)]);

    const ended = await run(pool, 'block', counting, 500);
    const after = await Promise.all([counted(pool), counted(pool)]);

    expect(new Set(warm.map(({ thread }) => thread)).size).toBe(2);
    expect(ended).toMatchObject({ ran: 'stopped', because: 'deadline' });
    expect(after.filter(({ thread }) => warm.some((each) => each.thread === thread))).toHaveLength(1);
    expect(after.map(({ jobs }) => jobs).toSorted((first, second) => first - second)).toEqual([1, 2]);
  });
});

describe('a pool that closes', () => {
  it('ends its idle workers, and its busy jobs as closing, leaving no thread alive', async () => {
    const before = threadsAlive();
    const pool = poolOf();
    await counted(pool);

    const blocked = run(pool, 'block');
    await counted(pool);
    await pool.close();

    expect(await blocked).toMatchObject({ ran: 'stopped', because: 'closing' });
    expect(threadsAlive() - before).toBe(0);
  });

  it.each([
    ['once it is closed', 'await pool.close();'],
    ['while its workers are idle', ''],
  ])('holds no process open %s', async (_when, closing) => {
    const script = [
      `const { programPool } = await import('${new URL('program-pool.ts', import.meta.url).href}');`,
      `const { handedWorkersOf } = await import('${new URL('handed-files.ts', import.meta.url).href}');`,
      `const { shippedFilesOnDisk } = await import('${import.meta.resolve('@on.auto/operations/shipped-files-on-disk')}');`,
      "const pool = programPool({ handed: await handedWorkersOf(shippedFilesOnDisk), instances: 'fresh', workers: 2, heapMegabytes: 64 });",
      "const source = 'export default function (input) { return input + 1; }';",
      "const outcome = await pool.run({ source, arguments: [1], entry: 'default', moment: 0, budget: 500, memoryBytes: 67108864, stackBytes: 1048576, deadlineMs: 10000, mostOutputBytes: 100 });",
      closing,
      'process.stdout.write(JSON.stringify(outcome));',
    ].join('\n');

    const stdout = await executed(script);

    expect(JSON.parse(stdout)).toMatchObject({ ran: 'answered', output: 2 });
  });
});
