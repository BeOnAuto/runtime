import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { FoldingView } from '../folds/fold-page.ts';
import type {
  FoldOutcome,
  FoldRequest,
  ModuleAddress,
  PoolOutcome,
  PoolSettings,
  ProgramPool,
} from '../jobs/pool-contract.ts';
import { begun, counting, countingElsewhere, countingOnTheLoop } from '../pool-testing/counting-workers.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { threadEnded, threadsAlive } from '../pool-testing/threads-alive.ts';
import { longerThanTheTestMs, until } from '../pool-testing/waiting.ts';
import { unitMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { programPool } from './program-pool.ts';

interface Ran {
  readonly jobs: number;
  readonly thread: number;
}

interface Running {
  readonly deadlineMs?: number;
  readonly signal?: Readonly<AbortSignal>;
  readonly worker?: ModuleAddress;
}

const pools: ProgramPool[] = [];

const decodeRan = Schema.decodeUnknownSync(Schema.Struct({ jobs: Schema.Number, thread: Schema.Number }));

const noted = { type: 'noted' };

const adding = 'export function fold(view, event) {\n  return view + event.data.n;\n}';

const endless = 'export default function () {\n  for (;;) {}\n}';

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

function poolOf(settings: Partial<PoolSettings> = {}): ProgramPool {
  const pool = programPool({ ...testPoolSettings(4), ...settings });
  pools.push(pool);
  return pool;
}

function run(pool: ProgramPool, source: string, running: Running = {}): Promise<PoolOutcome> {
  const { deadlineMs = 10_000, signal, worker = counting } = running;
  return pool.run(
    {
      source,
      entry: 'default',
      arguments: [null],
      moment: 0,
      budget: 20_000,
      memoryBytes: unitMemoryBytes,
      stackBytes: workerStackBytes,
      deadlineMs,
      mostOutputBytes: 1_048_576,
      worker,
    },
    signal,
  );
}

function ranOf(outcome: PoolOutcome): Ran {
  return decodeRan(outcome.ran === 'answered' ? outcome.output : {});
}

async function counted(pool: ProgramPool, worker: ModuleAddress = counting): Promise<Ran> {
  return ranOf(await run(pool, 'count', { worker }));
}

function foldOf(
  pool: ProgramPool,
  views: readonly Partial<FoldingView>[],
  more: Partial<FoldRequest> = {},
): Promise<FoldOutcome> {
  return pool.fold({
    events: [
      { ...noted, data: { n: 1 } },
      { ...noted, data: { n: 2 } },
    ],
    views: views.map((view) => ({ fold: adding, filters: [noted], view: 0, events: [0, 1], ...view })),
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
    waitMs: 10_000,
    deadlineMs: 13_000,
    worker: countingOnTheLoop,
    ...more,
  });
}

describe('a worker of the pool kept between jobs', () => {
  it('takes job after job in one thread, which counts them 1, 2 and 3', async () => {
    const pool = poolOf();

    const ran = [await counted(pool), await counted(pool), await counted(pool)];

    expect(ran.map(({ jobs }) => jobs)).toEqual([1, 2, 3]);
    expect(new Set(ran.map(({ thread }) => thread)).size).toBe(1);
  });

  it('keeps the warm worker a job takes past the time it may idle, so a job longer than that answers in the same thread', async () => {
    const pool = poolOf({ idleMs: 100 });
    const first = await counted(pool);

    const held = await run(pool, 'hold');

    expect(ranOf(held)).toEqual({ jobs: 2, thread: first.thread });
  });

  it('is recycled after the last of the jobs a worker takes', async () => {
    const pool = poolOf({ jobsPerWorker: 2 });

    const ran = [await counted(pool), await counted(pool), await counted(pool)];

    expect(ran.map(({ jobs }) => jobs)).toEqual([1, 2, 1]);
  });

  it('is let go of once it has been idle for the time a worker may idle', async () => {
    const pool = poolOf({ idleMs: 100 });
    const first = await counted(pool);

    await until(() => threadEnded(first.thread));
    const next = await counted(pool);

    expect([first.jobs, next.jobs]).toEqual([1, 1]);
    expect(next.thread).not.toBe(first.thread);
  });
});

describe('a worker of the pool after a job the pool had to stop', () => {
  it.each<readonly [string, string, Partial<PoolSettings>, Readonly<Record<string, unknown>>]>([
    ['its deadline stopped', 'block', {}, { ran: 'stopped', because: 'deadline' }],
    ['ran out of memory', 'allocate', { heapMegabytes: 16 }, { ran: 'stopped', because: 'memory' }],
    ['crashed', 'crash', {}, { ran: 'crashed', detail: 'The worker failed: broken on purpose' }],
    ['answered a job it was not given', 'wrong job', {}, { ran: 'crashed' }],
    ['answered that it may not be kept', 'let go', {}, { ran: 'answered' }],
  ])(
    'is let go of after a job it %s, so the next job starts in a fresh worker',
    async (_why, source, settings, ended) => {
      const pool = poolOf(settings);
      const first = await counted(pool);

      const outcome = await run(pool, source, { deadlineMs: 2000 });
      const next = await counted(pool);

      expect(outcome).toMatchObject(ended);
      expect([first.jobs, next.jobs]).toEqual([1, 1]);
      expect(next.thread).not.toBe(first.thread);
    },
  );

  it('is let go of after a job its caller cancelled', async () => {
    const pool = poolOf();
    const first = await counted(pool);
    const cancelling = new AbortController();
    const beginning = begun(1);

    const blocked = run(pool, 'block', { signal: cancelling.signal });
    const reached = await beginning;
    cancelling.abort();

    expect(reached).toEqual([{ source: 'block', thread: first.thread }]);
    expect(await blocked).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect([first.jobs, (await counted(pool)).jobs]).toEqual([1, 1]);
  });
});

describe('a job of the pool cancelled before it has a worker', () => {
  it('ends as cancelled a job cancelled while it waits for its seat, starting no worker for it, rather than running it to its deadline', async () => {
    const before = threadsAlive();
    const pool = poolOf({ workers: 1 });
    await counted(pool);
    const cancelling = new AbortController();

    const blocked = run(pool, 'block', {
      deadlineMs: longerThanTheTestMs,
      signal: cancelling.signal,
      worker: countingElsewhere,
    });
    setImmediate(() => {
      cancelling.abort();
    });
    const ended = await blocked;
    const afterTheCancel = threadsAlive() - before;

    expect(ended).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect(afterTheCancel).toBe(0);
    expect((await counted(pool)).jobs).toBe(1);
  });

  it('rests the warm worker it took for a job cancelled before the job reached it, and serves the next job there', async () => {
    const pool = poolOf();
    const first = await counted(pool);
    const cancelling = new AbortController();

    const cancelled = run(pool, 'count', { signal: cancelling.signal });
    queueMicrotask(() => {
      cancelling.abort();
    });

    expect(await cancelled).toMatchObject({ ran: 'stopped', because: 'cancelled' });
    expect(await counted(pool)).toEqual({ jobs: 2, thread: first.thread });
  });
});

describe('a worker of the pool after a job whose answer says not to keep it', () => {
  it('is let go of after a program its evaluator ended at the deadline', async () => {
    const pool = poolOf();

    const ran = [
      await counted(pool, countingOnTheLoop),
      await run(pool, `early:${endless}`, { worker: countingOnTheLoop }),
      await counted(pool, countingOnTheLoop),
    ];

    expect(ran).toMatchObject([{ jobs: 1 }, { ran: 'exhausted', limit: 'deadline' }, { jobs: 1 }]);
  });
});

describe('a fold worker of the pool after a page whose answer says not to keep it', () => {
  it.each<readonly [string, Partial<FoldRequest>, Readonly<Record<string, unknown>>]>([
    [
      'a view ran past its deadline',
      { foldDeadlineMs: 1, budget: Number.MAX_SAFE_INTEGER },
      { ran: 'folded', views: [{ overtime: 0 }] },
    ],
    ['it could not read', { mostViewBytes: 0 }, { ran: 'unreadable' }],
  ])('is let go of after a page %s', async (_why, more, ended) => {
    const pool = poolOf();
    const slow = { fold: 'export function fold(view) {\n  for (;;) {}\n}' };

    const ran = [
      await counted(pool, countingOnTheLoop),
      await foldOf(pool, [slow], more),
      await counted(pool, countingOnTheLoop),
    ];

    expect(ran).toMatchObject([{ jobs: 1 }, ended, { jobs: 1 }]);
  });

  it('keeps its worker after a page that stalled, which then folds the next page as a fresh worker does', async () => {
    const warm = poolOf({ workers: 1 });
    const views = [
      {},
      {
        fold: 'export function fold(view, event) {\n  return [view, event.data.n];\n}',
        view: [],
      },
    ];

    const stalled = await foldOf(warm, [
      {
        fold: 'export function fold(view, event) {\n  throw new Error(`stop ${event.data.n}`);\n}',
      },
    ]);
    const afterTheStall = await foldOf(warm, views);
    const ran = await counted(warm, countingOnTheLoop);
    const cold = await foldOf(poolOf({ workers: 1 }), views);

    expect(stalled).toMatchObject({
      ran: 'folded',
      views: [{ stall: { kind: 'raised', message: 'Error: stop 1' } }],
    });
    expect({ ...afterTheStall, milliseconds: 0 }).toEqual({ ...cold, milliseconds: 0 });
    expect(ran.jobs).toBe(3);
  });
});

describe('a worker of the pool that, idle, sends a message, fails or ends', () => {
  it.each(['then message', 'then throw', 'then exit'])(
    'is forgotten, ending no job, and the next job starts afresh (%s)',
    async (misbehaviour) => {
      const pool = poolOf();
      const first = ranOf(await run(pool, misbehaviour));

      await until(() => threadEnded(first.thread));
      const next = await counted(pool);

      expect([first.jobs, next.jobs]).toEqual([1, 1]);
      expect(next.thread).not.toBe(first.thread);
    },
  );
});
