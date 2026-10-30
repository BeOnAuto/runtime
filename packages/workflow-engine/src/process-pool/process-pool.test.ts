import { Schema } from 'effect';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { until } from '../pool-testing/waiting.ts';
import { fakeProcesses, isAlive, nudge } from '../process-testing/fake-processes.ts';
import {
  processPool,
  type ProcessOutcome,
  type ProcessPool,
  type ProcessPoolSettings,
  type ProcessRequest,
} from './process-pool.ts';
import type { ProcessValue } from './process-values.ts';

interface Ran {
  readonly jobs: number;
  readonly pid: number;
}

const mebibyte = 1_048_576;

const ordinaryDeadlineMs = 30_000;

const fake = fakeProcesses();

const pools: ProcessPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, pid: Schema.Number }));

const addedOutsideThePool: ReadonlySet<string> = new Set(['__CF_USER_TEXT_ENCODING', 'NODE_V8_COVERAGE']);

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

afterAll(() => {
  fake.remove();
});

function kept(pool: ProcessPool): ProcessPool {
  pools.push(pool);
  return pool;
}

function poolOf(settings: Partial<ProcessPoolSettings> = {}): ProcessPool {
  return kept(processPool({ processes: 4, longJobs: 1, memoryBytes: 1024 * mebibyte, path: fake.bare, ...settings }));
}

function run(
  pool: ProcessPool,
  kind: string,
  payload: ProcessValue = null,
  more: Partial<ProcessRequest> = {},
): Promise<ProcessOutcome> {
  return pool.run({ module: fake.module, key: 'a model', kind, payload, deadlineMs: ordinaryDeadlineMs, ...more });
}

function ranOf(outcome: ProcessOutcome): Ran {
  return decodeRan(outcome.ended === 'answered' ? outcome.answer : {});
}

async function echoed(pool: ProcessPool, key = 'a model'): Promise<Ran> {
  return ranOf(await run(pool, 'echo', null, { key }));
}

function namesIn(outcome: ProcessOutcome): readonly unknown[] {
  const answer = outcome.ended === 'answered' ? outcome.answer : null;
  return Array.isArray(answer) ? answer : ['no answer'];
}

function isOwn(name: unknown): boolean {
  return typeof name !== 'string' || !addedOutsideThePool.has(name);
}

const failedToSend: unknown = expect.stringContaining('The process failed');

const failedToStart: unknown = expect.stringMatching(/^The process failed: spawn .*ENOENT/u);

interface Ending {
  readonly why: string;
  readonly kind: string;
  readonly payload: ProcessValue;
  readonly deadlineMs: number;
  readonly ended: Readonly<Record<string, unknown>>;
}

function endingOf(
  why: string,
  kind: string,
  ended: Readonly<Record<string, unknown>>,
  payload: ProcessValue = null,
): Ending {
  return { why, kind, payload, deadlineMs: ordinaryDeadlineMs, ended };
}

const endings: readonly Ending[] = [
  { ...endingOf('ran past its deadline', 'block', { ended: 'timed_out' }), deadlineMs: 1000 },
  endingOf('aborted, as at its memory bound', 'abort', { ended: 'out_of_memory' }),
  endingOf('could not allocate', 'fail to allocate', { ended: 'out_of_memory' }),
  endingOf('exited', 'exit', { ended: 'crashed', detail: 'The process ended with code 3 before it answered' }, 3),
  endingOf('was ended by a signal', 'terminate', {
    ended: 'crashed',
    detail: 'The process ended by SIGTERM before it answered',
  }),
  endingOf('raised', 'throw', { ended: 'crashed', detail: 'Error: broken on purpose' }, 'broken on purpose'),
  endingOf('was not one it serves', 'nothing', {
    ended: 'crashed',
    detail: 'This process serves no job of the kind nothing',
  }),
  endingOf('answered for another job', 'wrong job', {
    ended: 'crashed',
    detail: expect.stringMatching(/^The process answered job \d+ while it ran job \d+$/u),
  }),
  endingOf('answered with something that is not an answer', 'garbage', {
    ended: 'crashed',
    detail: 'The process answered with something that is not an answer',
  }),
  endingOf('answered with something it could not read', 'undecodable', {
    ended: 'crashed',
    detail: 'The process answered with something that is not an answer',
  }),
];

describe('a job of a process of the pool', () => {
  it('is answered with what the process answered, its typed arrays crossing the pipe both ways as base64', async () => {
    const pool = poolOf();

    const outcome = await run(pool, 'typed', { values: new Float32Array([1.5, -2]) });

    expect(outcome).toMatchObject({
      ended: 'answered',
      answer: {
        given: { values: new Float32Array([1.5, -2]) },
        doubled: new Float64Array([3, -4]),
        bytes: new Uint8Array([1, 2, 255]),
      },
    });
  });

  it('runs in a process started with an empty environment, whatever the server was started with, but for what the operating system and the coverage of these tests add', async () => {
    vi.stubEnv('API_KEYS', 'a key the server holds');
    const pool = kept(
      processPool({ processes: 2, longJobs: 1, memoryBytes: 1024 * mebibyte, path: process.env['PATH'] }),
    );

    const outcome = await run(pool, 'environment');
    vi.unstubAllEnvs();

    expect(namesIn(outcome).filter((name) => isOwn(name))).toEqual([]);
  });

  it.each<readonly [string, ProcessValue]>([
    [
      'an object of the two names alone that a typed array crosses the pipe as',
      { $typed: 'Uint8Array', base64: 'AQID' },
    ],
    ['a number that is not finite, which JSON would carry as null', { values: [1, Number.NaN] }],
  ])('ends crashed, before it takes a permit, when its payload holds %s', async (_what, payload) => {
    const pool = poolOf({ processes: 1 });
    const holding = run(pool, 'sleep', 300);

    const endedFirst = await Promise.race([
      run(pool, 'echo', payload),
      holding.then(() => 'the job holding the permit'),
    ]);

    expect(endedFirst).toMatchObject({
      ended: 'crashed',
      detail: 'The payload holds what the pipe to a process cannot carry',
    });
    expect((await holding).ended).toBe('answered');
  });
});

describe('a process of the pool kept between jobs', () => {
  it('takes job after job of its key, which it counts 1, 2 and 3, while another key has a process of its own', async () => {
    const pool = poolOf();

    const ran = [await echoed(pool), await echoed(pool), await echoed(pool)];
    const elsewhere = await echoed(pool, 'another model');

    expect(ran.map(({ jobs }) => jobs)).toEqual([1, 2, 3]);
    expect(new Set(ran.map(({ pid }) => pid)).size).toBe(1);
    expect([elsewhere.jobs, elsewhere.pid === ran[0]?.pid]).toEqual([1, false]);
  });

  it('is let go of after the last of the jobs a process takes', async () => {
    const pool = poolOf({ jobsPerProcess: 2 });

    const ran = [await echoed(pool), await echoed(pool), await echoed(pool)];

    expect(ran.map(({ jobs }) => jobs)).toEqual([1, 2, 1]);
  });

  it('is let go of once it has been idle for the time a process may idle, but not while a job longer than that runs', async () => {
    const pool = poolOf({ idleMs: 100 });
    const first = await echoed(pool);

    const slept = ranOf(await run(pool, 'sleep', 300));
    await until(() => !isAlive(first.pid));
    const next = await echoed(pool);

    expect([slept.pid, slept.jobs]).toEqual([first.pid, 2]);
    expect([next.jobs, next.pid === first.pid, isAlive(first.pid)]).toEqual([1, false, false]);
  });
});

describe('a process of the pool after a job that ended it', () => {
  it.each(endings)(
    'is let go of after a job it $why, so the next job of its key starts in a fresh process',
    async ({ kind, payload, deadlineMs, ended }) => {
      const pool = poolOf();
      const warm = await echoed(pool);

      const outcome = await run(pool, kind, payload, { deadlineMs });
      const next = await echoed(pool);

      expect(outcome).toMatchObject(ended);
      expect([next.jobs, next.pid === warm.pid, isAlive(warm.pid)]).toEqual([1, false, false]);
    },
  );
});

describe('a process of the pool that misbehaves', () => {
  it.each([
    ['writes to the pool', 'stray'],
    ['exits', 'then exit'],
  ])('is forgotten when it %s while idle, ending nothing, and the next job starts afresh', async (_what, kind) => {
    const pool = poolOf();

    const first = await run(pool, kind);
    const { pid } = ranOf(first);
    nudge(pid);
    await until(() => !isAlive(pid));
    const next = await echoed(pool);

    expect(first).toMatchObject({ ended: 'answered' });
    expect([next.jobs, next.pid === pid]).toEqual([1, false]);
  });

  it('ends a job it could not send to its process as crashed, and lets that process go', async () => {
    const pool = poolOf();
    const first = ranOf(await run(pool, 'disconnect later'));
    await until(() => fake.announced(first.pid, 'disconnected'));

    const outcome = await run(pool, 'echo');
    const next = await echoed(pool);

    expect(outcome).toMatchObject({ ended: 'crashed', detail: failedToSend });
    expect([next.jobs, isAlive(first.pid)]).toEqual([1, false]);
  });
});

describe('a job of the pool that never reaches its process', () => {
  it('ends a job crashed when its module does not load, or its process cannot start at all', async () => {
    const gone = fakeProcesses();
    const pool = poolOf({ path: gone.limiting });
    gone.removeLimiter();

    const unloaded = await run(poolOf(), 'echo', null, { module: fake.missing });
    const unstarted = await run(pool, 'echo');
    gone.remove();

    expect(unloaded).toMatchObject({ ended: 'crashed', detail: 'The process ended with code 1 before it answered' });
    expect(unstarted).toMatchObject({ ended: 'crashed', detail: failedToStart });
  });

  it('ends a job cancelled while it runs, and lets go of its process', async () => {
    const pool = poolOf();
    const warm = await echoed(pool);
    const cancelling = new AbortController();

    const running = pool.run(
      { module: fake.module, key: 'a model', kind: 'begin and wait', payload: null, deadlineMs: ordinaryDeadlineMs },
      cancelling.signal,
    );
    await until(() => fake.announced(warm.pid, 'began'));
    cancelling.abort();
    const outcome = await running;

    expect(outcome).toMatchObject({ ended: 'cancelled' });
    expect(isAlive(warm.pid)).toBe(false);
  });
});
