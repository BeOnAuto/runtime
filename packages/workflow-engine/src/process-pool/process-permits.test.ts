import { once } from 'node:events';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { longerThanTheTestMs, until } from '../pool-testing/waiting.ts';
import { fakeProcesses, isAlive } from '../process-testing/fake-processes.ts';
import {
  processPool,
  type ProcessOutcome,
  type ProcessPool,
  type ProcessPoolSettings,
  type ProcessRequest,
} from './process-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly pid: number;
}

const timerSlackMs = 2;

const fake = fakeProcesses();

const pools: ProcessPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, pid: Schema.Number }));

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

afterAll(() => {
  fake.remove();
});

function poolOf(settings: Partial<ProcessPoolSettings> = {}): ProcessPool {
  const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 1_073_741_824, path: fake.bare, ...settings });
  pools.push(pool);
  return pool;
}

function run(pool: ProcessPool, kind: string, more: Partial<ProcessRequest> = {}): Promise<ProcessOutcome> {
  return pool.run({ module: fake.module, key: 'a model', kind, payload: 1000, deadlineMs: 10_000, ...more });
}

function ranOf(outcome: ProcessOutcome): Ran {
  return decodeRan(outcome.ended === 'answered' ? outcome.answer : {});
}

async function echoed(pool: ProcessPool, key: string): Promise<Ran> {
  return ranOf(await run(pool, 'echo', { key }));
}

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

describe('the processes of a pool and its permits', () => {
  it('runs at most as many jobs at once as it has permits, and a job that finds none within its deadline is busy', async () => {
    const pool = poolOf();
    const holding = [run(pool, 'sleep', { key: 'a' }), run(pool, 'sleep', { key: 'b' })];

    const third = await run(pool, 'echo', { key: 'c', deadlineMs: 300 });
    const held = await Promise.all(holding);

    expect(third).toMatchObject({ ended: 'busy' });
    expect(third.milliseconds).toBeGreaterThanOrEqual(300 - timerSlackMs);
    expect(held.map(({ ended }) => ended)).toEqual(['answered', 'answered']);
  });

  it('lets go of the oldest idle process before it starts one for another key, so the processes alive never exceed its permits', async () => {
    const pool = poolOf();
    const first = await echoed(pool, 'a');
    const second = await echoed(pool, 'b');

    const third = await echoed(pool, 'c');

    expect([isAlive(first.pid), isAlive(second.pid), isAlive(third.pid)]).toEqual([false, true, true]);
  });

  it('holds back for long jobs no more permits than its share, so a short job always finds one', async () => {
    const pool = poolOf({ processes: 3, longJobs: 2 });
    const settled = { long: false };
    const long = Promise.all([
      run(pool, 'begin and wait', { key: 'a', long: true, deadlineMs: longerThanTheTestMs }),
      run(pool, 'begin and wait', { key: 'b', long: true, deadlineMs: longerThanTheTestMs }),
    ]).then((outcomes: readonly ProcessOutcome[]) => {
      settled.long = true;
      return outcomes;
    });

    const thirdLong = await run(pool, 'echo', { key: 'c', long: true, deadlineMs: 300 });
    const short = await run(pool, 'echo', { key: 'd', deadlineMs: longerThanTheTestMs });
    const whileTheLongRan = !settled.long;
    await pool.close();

    expect([thirdLong.ended, short.ended, whileTheLongRan]).toEqual(['busy', 'answered', true]);
    expect((await long).map(({ ended }) => ended)).toEqual(['closing', 'closing']);
  });
});

describe('a pool one of whose processes is blocked', () => {
  it('answers a job of another key while the blocked job runs', async () => {
    const pool = poolOf();
    const warm = await echoed(pool, 'a');
    const other = await echoed(pool, 'b');
    const settled = { blocked: false };

    const blocked = run(pool, 'block', { key: 'a', deadlineMs: longerThanTheTestMs }).then((outcome) => {
      settled.blocked = true;
      return outcome;
    });
    await until(() => fake.announced(warm.pid, 'began'));
    const elsewhere = await echoed(pool, 'b');
    const answeredWhileBlocked = !settled.blocked;
    await pool.close();

    expect([elsewhere.pid === other.pid, answeredWhileBlocked]).toEqual([true, true]);
    expect(await blocked).toMatchObject({ ended: 'closing' });
  });
});

describe('the deadline of a job of a process', () => {
  it('starts once the job holds its process, so a job that waited for a permit still has the whole of it to run', async () => {
    const pool = poolOf();
    await echoed(pool, 'a');
    await echoed(pool, 'b');
    const holding = run(pool, 'sleep', { key: 'a', long: true, payload: 1500 });

    const waited = await run(pool, 'sleep', { key: 'b', long: true, payload: 2000, deadlineMs: 3000 });
    await holding;

    expect(waited.ended).toBe('answered');
    expect(waited.milliseconds).toBeGreaterThan(3000);
  });

  it('still ends a job that waited for a permit once it has run for the whole of its deadline from its hold', async () => {
    const pool = poolOf();
    await echoed(pool, 'a');
    await echoed(pool, 'b');
    const holding = run(pool, 'sleep', { key: 'a', long: true, payload: 1500 });

    const waited = await run(pool, 'sleep', { key: 'b', long: true, payload: 6000, deadlineMs: 3000 });
    await holding;

    expect(waited.ended).toBe('timed_out');
    expect([waited.milliseconds > 3000, waited.milliseconds < 6000]).toEqual([true, true]);
  });

  it('kills a warm process blocked past it, no sooner, and the next job of its key starts afresh', async () => {
    const pool = poolOf();
    const warm = await echoed(pool, 'a');

    const outcome = await run(pool, 'block', { key: 'a', deadlineMs: 1000 });
    const after = await echoed(pool, 'a');

    expect(outcome).toMatchObject({ ended: 'timed_out' });
    expect(outcome.milliseconds).toBeGreaterThanOrEqual(1000 - timerSlackMs);
    expect([after.jobs, after.pid === warm.pid, isAlive(warm.pid)]).toEqual([1, false, false]);
  });
});

describe('a pool of processes that closes', () => {
  it('ends its idle processes and its busy ones, a busy job as closing, and runs no job after', async () => {
    const pool = poolOf();
    const idle = await echoed(pool, 'a');
    const warm = await echoed(pool, 'b');
    const busy = run(pool, 'begin and wait', { key: 'b', deadlineMs: longerThanTheTestMs });
    await until(() => fake.announced(warm.pid, 'began'));

    await pool.close();
    const after = await run(pool, 'echo', { key: 'a' });

    expect([(await busy).ended, after.ended]).toEqual(['closing', 'closing']);
    expect([isAlive(idle.pid), isAlive(warm.pid)]).toEqual([false, false]);
  });

  it('ends as closing a job that waits for a permit', async () => {
    const pool = poolOf({ processes: 1 });
    const warm = await echoed(pool, 'a');
    const busy = run(pool, 'begin and wait', { key: 'a', deadlineMs: longerThanTheTestMs });
    const waiting = run(pool, 'echo', { key: 'b', deadlineMs: longerThanTheTestMs });
    await until(() => fake.announced(warm.pid, 'began'));

    await pool.close();

    expect((await Promise.all([busy, waiting])).map(({ ended }) => ended)).toEqual(['closing', 'closing']);
  });

  it.each([
    ['once it is closed', 'await pool.close();'],
    ['while its processes are idle', ''],
  ])('holds the server open no longer %s', async (_when, closing) => {
    const script = [
      `const { processPool } = await import('${new URL('process-pool.ts', import.meta.url).href}');`,
      `const pool = processPool({ processes: 2, longJobs: 1, memoryBytes: 1073741824, path: ${JSON.stringify(fake.bare)} });`,
      `const outcome = await pool.run({ module: () => new URL('${fake.module().href}'), key: 'a', kind: 'echo', payload: 1, deadlineMs: 10000 });`,
      closing,
      'process.stdout.write(JSON.stringify(outcome.ended));',
    ].join('\n');

    expect(await executed(script)).toBe('"answered"');
  });
});
