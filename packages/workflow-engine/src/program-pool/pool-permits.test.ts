import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ModuleAddress, PoolOutcome, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import { begun, counting, countingElsewhere, released } from '../pool-testing/counting-workers.ts';
import { printedByTheScript } from '../pool-testing/printed-scripts.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { threadsAlive } from '../pool-testing/threads-alive.ts';
import { afterFakeTime, fakePoolTimers } from '../pool-testing/waiting.ts';
import { unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { programPool } from './program-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly thread: number;
}

const pools: ProgramPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }));

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
  worker: ModuleAddress = counting,
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

async function counted(pool: ProgramPool, worker: ModuleAddress = counting): Promise<Ran> {
  return ranOf(await run(pool, 'count', worker));
}

function holding(pool: ProgramPool, jobs: number, worker: ModuleAddress = counting): Promise<readonly PoolOutcome[]> {
  return Promise.all(Array.from({ length: jobs }, () => run(pool, 'hold', worker)));
}

async function held(pool: ProgramPool, jobs: number): Promise<readonly number[]> {
  const beginning = begun(jobs);
  const outcomes = holding(pool, jobs);
  await beginning;
  released();
  return (await outcomes).map((outcome) => ranOf(outcome).thread);
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
    const holdingAgain = holding(pool, 4);
    await beginning;
    const whileHolding = threadsAlive() - before;
    released();
    const again = (await holdingAgain).map((outcome) => ranOf(outcome).thread);

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
    const lingering = begun(2);
    const warm = Promise.all([run(pool, 'count'), run(pool, 'linger')]);
    await lingering;
    released();
    await warm;

    const beginning = begun(2);
    const both = holding(pool, 2, countingElsewhere);
    await beginning;
    const whileTheLastDies = threadsAlive() - before;
    released();
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
    fakePoolTimers();
    const pool = poolOf({ workers: 2 });
    const warm = await Promise.all([counted(pool), counted(pool)]);
    const beginning = begun(1);

    const blocked = run(pool, 'block', counting, 500);
    await beginning;
    const ended = await afterFakeTime(500, blocked);
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
      `const { sandboxShippedRoots } = await import('${new URL('../instances/compiled-module.ts', import.meta.url).href}');`,
      `const { shippedFilesOnDisk } = await import('${import.meta.resolve('@on.auto/shipped-files/on-disk')}');`,
      'const handed = await handedWorkersOf(shippedFilesOnDisk(sandboxShippedRoots()));',
      "const pool = programPool({ handed, instances: 'fresh', workers: 2, heapMegabytes: 64 });",
      "const source = 'export default function (input) { return input + 1; }';",
      "const outcome = await pool.run({ source, arguments: [1], entry: 'default', moment: 0, budget: 500, memoryBytes: 67108864, stackBytes: 1048576, deadlineMs: 10000, mostOutputBytes: 100 });",
      closing,
      'process.stdout.write(JSON.stringify(outcome));',
    ].join('\n');

    const stdout = await printedByTheScript(script);

    expect(JSON.parse(stdout)).toMatchObject({ ran: 'answered', output: 2 });
  });
});
