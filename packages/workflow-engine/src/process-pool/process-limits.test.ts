import { join } from 'node:path';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ModuleAddress } from '../jobs/pool-contract.ts';
import { fakeProcesses, type FakeProcesses } from '../process-testing/fake-processes.ts';
import { memoryLimiter } from './memory-limit.ts';
import { processPool, type ProcessOutcome, type ProcessPool, type ProcessPoolSettings } from './process-pool.ts';
import type { ProcessValue } from './process-values.ts';

const ordinaryDeadlineMs = 10_000;

const mebibyte = 1_048_576;

const fakeBound = 512 * mebibyte;

const realBound = 1024 * mebibyte;

const onLinux = process.platform === 'linux';

const elsewhere = onLinux ? '' : ', skipped: prlimit bounds the memory of a process on Linux alone';

const theBoundsOfItsProcess: unknown = [
  expect.stringMatching(new RegExp(`^Max data size\\s+${realBound}\\s+${realBound}\\s+bytes`, 'u')),
  expect.stringMatching(/^Max core file size\s+0\s+0\s+bytes/u),
];

const decodePid = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Number }));

const pools: ProcessPool[] = [];

const fakes: FakeProcesses[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
  for (const fake of fakes.splice(0)) {
    fake.remove();
  }
});

function aFake(): FakeProcesses {
  const fake = fakeProcesses();
  fakes.push(fake);
  return fake;
}

function poolOf(settings: Pick<ProcessPoolSettings, 'path' | 'memoryBytes'>): ProcessPool {
  const pool = processPool({ processes: 2, longJobs: 1, ...settings });
  pools.push(pool);
  return pool;
}

function run(pool: ProcessPool, module: ModuleAddress, kind: string, payload: ProcessValue): Promise<ProcessOutcome> {
  return pool.run({ module, key: 'a', kind, payload, deadlineMs: ordinaryDeadlineMs });
}

function pidOf(outcome: ProcessOutcome): number {
  return decodePid(outcome.ended === 'answered' ? outcome.answer : {}).pid;
}

describe('the memory of a process of the pool', () => {
  it('is bounded by prlimit, given a core file size of 0 and the bound of its data, where prlimit is on the path', async () => {
    const fake = aFake();
    const pool = poolOf({ path: fake.limiting, memoryBytes: fakeBound });

    const outcome = await run(pool, fake.module, 'echo', 1);

    expect([pool.limiter, fake.limitedWith(), outcome.ended]).toEqual([
      join(fake.limiting, memoryLimiter),
      `--core=0 --data=${fakeBound}`,
      'answered',
    ]);
  });

  it('is not bounded where prlimit is not on the path, and the process starts all the same', async () => {
    const fake = aFake();
    const pool = poolOf({ path: fake.bare, memoryBytes: fakeBound });

    const outcome = await run(pool, fake.module, 'echo', 1);

    expect([pool.limiter, fake.limitedWith(), outcome.ended]).toEqual([undefined, undefined, 'answered']);
  });
});

describe(`the memory of a process of the pool on Linux${elsewhere}`, () => {
  it.skipIf(!onLinux)(
    'is bounded by the prlimit of the system, its data at the bound and its core file size at 0, so the kernel writes no core file, and a job that fills twice the bound ends out of memory while the next job starts in a fresh process',
    async () => {
      const fake = aFake();
      const pool = poolOf({ path: process.env['PATH'], memoryBytes: realBound });

      const limits = await run(pool, fake.module, 'limits', null);
      const allocated = await run(pool, fake.module, 'allocate', (2 * realBound) / mebibyte);
      const after = await run(pool, fake.module, 'echo', 1);

      expect(pool.limiter).toMatch(/\/prlimit$/u);
      expect(limits).toMatchObject({ ended: 'answered', answer: { limits: theBoundsOfItsProcess } });
      expect([allocated.ended, after.ended, pidOf(after) === pidOf(limits)]).toEqual([
        'out_of_memory',
        'answered',
        false,
      ]);
    },
  );
});
