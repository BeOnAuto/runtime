import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { CheckOutcome, CheckRequest, PoolOutcome, PoolSettings, ProgramPool } from '../jobs/pool-contract.ts';
import {
  brokenAtStart,
  checking,
  checkingForever,
  checkingReadyAfter,
  checkingWithTheFilesHanded,
} from '../pool-testing/checking-workers.ts';
import { counting } from '../pool-testing/counting-workers.ts';
import { handedSandbox, handedWorkers, testPoolSettings } from '../pool-testing/test-pools.ts';
import { nextThreadStarted, threadEnded } from '../pool-testing/threads-alive.ts';
import { isWatched, longerThanTheTestMs, until } from '../pool-testing/waiting.ts';
import { unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { checkPermits, mostCheckStartMs, programPool } from './program-pool.ts';

const slowStartMs = 2000;

const pools: ProgramPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ thread: Schema.Number }));

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(4), ...settings });
  pools.push(pool);
  return pool;
}

function checkOf(more: Partial<CheckRequest> = {}): CheckRequest {
  return {
    schemas: {},
    expressions: [{ source: '$data.a', names: ['$data'] }],
    deadlineMs: 2000,
    worker: checking,
    ...more,
  };
}

function detailsOf(outcome: CheckOutcome): readonly string[] {
  return outcome.ran === 'checked' ? outcome.issues.map(({ detail }) => detail) : [];
}

function threadOf(outcome: CheckOutcome): number | undefined {
  return outcome.ran === 'checked' ? outcome.issues[0]?.line : undefined;
}

function counted(pool: ProgramPool, source: string): Promise<PoolOutcome> {
  return pool.run({
    source,
    entry: 'default',
    arguments: [null],
    moment: 0,
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    deadlineMs: longerThanTheTestMs,
    mostOutputBytes: 1000,
    worker: counting,
  });
}

function blocked(pool: ProgramPool): Promise<PoolOutcome> {
  return counted(pool, 'block');
}

async function threadCounting(pool: ProgramPool): Promise<number> {
  const outcome = await counted(pool, 'count');
  return decodeRan(outcome.ran === 'answered' ? outcome.output : {}).thread;
}

describe('the permit of the checks of a pool', () => {
  it('runs on a permit of its own, so it never waits behind the runs that take every worker', async () => {
    const pool = poolOf({ workers: 2 });
    const runs = [blocked(pool), blocked(pool)];

    const checked = await pool.check(checkOf());

    expect(checkPermits).toBe(1);
    expect(checked).toMatchObject({ ran: 'checked', issues: [{ at: 0, detail: '$data.a' }] });
    await pool.close();
    expect(await Promise.all(runs)).toMatchObject([
      { ran: 'stopped', because: 'closing' },
      { ran: 'stopped', because: 'closing' },
    ]);
  });

  it('waits for its one permit until its deadline, and stops a check that runs past it', async () => {
    const pool = poolOf();
    const first = pool.check(checkOf({ worker: checkingForever, deadlineMs: 2000 }));

    const second = await pool.check(checkOf({ deadlineMs: 300 }));

    expect(second).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(await first).toMatchObject({ ran: 'stopped', because: 'deadline' });
  });

  it('takes no more checks once the pool is closed', async () => {
    const pool = poolOf();
    await pool.close();

    expect(await pool.check(checkOf())).toMatchObject({ ran: 'stopped', because: 'closing' });
  });
});

describe('the files the worker of a check starts with', () => {
  it('are those the settings of the pool hand its module, and no other, while a module they name nothing for starts with the module of the sandbox', async () => {
    const lib = new URL('file:///shipped/lib.txt');
    const named = checkingWithTheFilesHanded('named');
    const other = checkingWithTheFilesHanded('other');
    const pool = poolOf({ handed: { ...handedWorkers, modules: { [named.href]: { [lib.href]: Uint8Array.of(1) } } } });

    const ofTheNamed = await pool.check(checkOf({ worker: named }));
    const ofTheOther = await pool.check(checkOf({ worker: other }));

    expect(detailsOf(ofTheNamed)).toEqual([lib.href]);
    expect(detailsOf(ofTheOther)).toEqual(Object.keys(handedSandbox));
  });
});

describe('the worker of the checks of a pool, while it starts', () => {
  it('counts a check’s deadline from when its worker is ready, so a worker slower to start than the deadline answers', async () => {
    const pool = poolOf();

    const checked = await pool.check(checkOf({ worker: checkingReadyAfter(slowStartMs), deadlineMs: 300 }));

    expect(checked).toMatchObject({ ran: 'checked' });
    expect(checked.milliseconds).toBeGreaterThan(slowStartMs);
    expect(mostCheckStartMs).toBe(10_000);
  });

  it('ends a check busy when its worker is not ready within the start a check allows, and never ends the worker while it starts', async () => {
    const pool = poolOf({ checkStartMs: 200 });
    const worker = checkingReadyAfter(slowStartMs);
    const starting = nextThreadStarted();

    const early = await pool.check(checkOf({ worker }));
    const started = await starting;
    const cancelling = new AbortController();
    const cancelled = pool.check(checkOf({ worker }), cancelling.signal);
    await until(() => isWatched(cancelling.signal));
    cancelling.abort();
    await until(async () => threadOf(await pool.check(checkOf({ worker }))) === started);
    const second = await pool.check(checkOf({ worker }));

    expect(early).toMatchObject({ ran: 'stopped', because: 'busy' });
    expect(await cancelled).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect(threadOf(second)).toBe(started);
  });

  it('ends a check closing when the pool closes while its worker starts, and crashed when the worker ends before it is ready', async () => {
    const pool = poolOf();
    const watched = new AbortController();
    const starting = pool.check(checkOf({ worker: checkingReadyAfter(slowStartMs) }), watched.signal);
    await until(() => isWatched(watched.signal));

    await pool.close();

    expect(await starting).toMatchObject({ ran: 'stopped', because: 'closing' });
    expect(await poolOf().check(checkOf({ worker: brokenAtStart }))).toMatchObject({
      ran: 'crashed',
      detail: 'The worker ended before it was ready',
    });
  });
});

describe('the worker of the checks of a pool, once it started', () => {
  it('is kept however long it idles, so a save never waits for its start again', async () => {
    const pool = poolOf({ idleMs: 100 });

    const first = await pool.check(checkOf());
    const programThread = await threadCounting(pool);
    await until(() => threadEnded(programThread));
    const later = await pool.check(checkOf());

    expect(threadOf(later)).toBe(threadOf(first));
  });
});
