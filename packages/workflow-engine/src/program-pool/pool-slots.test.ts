import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { Effect, Function, Option } from 'effect';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { crashed, stopped } from '../jobs/job-endings.ts';
import type { ProgramPool, ProgramRequest } from '../jobs/pool-contract.ts';
import type { Job } from '../jobs/pool-job.ts';
import { testPoolSettings } from '../pool-testing/test-pools.ts';
import { runMemoryBytes, workerStackBytes } from '../programs/sandbox-bounds.ts';
import { poolSlots } from './pool-slots.ts';
import type { StartThread, Thread, ThreadHooks } from './pool-threads.ts';
import { poolWorkers } from './pool-workers.ts';
import { programPool } from './program-pool.ts';

function inMs(milliseconds: number): number {
  return performance.now() + milliseconds;
}

const pools: ProgramPool[] = [];

function keepingPool(): ProgramPool {
  const pool = programPool({ ...testPoolSettings(1), instances: 'kept' });
  pools.push(pool);
  return pool;
}

function request(body: string): ProgramRequest {
  return {
    source: `export default function (input) {\n  ${body}\n}`,
    entry: 'default',
    arguments: [1],
    moment: 0,
    budget: 20_000,
    memoryBytes: runMemoryBytes,
    stackBytes: workerStackBytes,
    deadlineMs: 10_000,
    mostOutputBytes: 1000,
  };
}

interface HeldThreads {
  readonly start: StartThread<string>;
  readonly started: () => readonly string[];
  readonly endAsked: (key: string) => Promise<void>;
  readonly ended: (key: string) => void;
}

interface Ending {
  readonly asked: PromiseWithResolvers<void>;
  readonly done: PromiseWithResolvers<void>;
}

function heldThreads(): HeldThreads {
  const started: string[] = [];
  const endings = new Map<string, Ending>();
  const endingOf = (key: string): Ending => {
    const ending = endings.get(key) ?? { asked: Promise.withResolvers<void>(), done: Promise.withResolvers<void>() };
    endings.set(key, ending);
    return ending;
  };
  const threadOf = (work: Job<unknown, string>, hooks: ThreadHooks<string>): Thread<string> => {
    const served = { jobs: 0 };
    const ending = endingOf(work.key);
    const thread: Thread<string> = {
      key: work.key,
      jobs: () => served.jobs,
      serve: (job, given) => {
        served.jobs += 1;
        return Promise.resolve({ ending: Option.getOrElse(given.decode(job), () => crashed('unread')), keep: true });
      },
      rest: Function.constVoid,
      wake: Function.constVoid,
      end: async () => {
        ending.asked.resolve();
        await ending.done.promise;
        hooks.gone(thread);
      },
    };
    return thread;
  };
  return {
    start: (work, hooks) => {
      started.push(work.key);
      return threadOf(work, hooks);
    },
    started: () => started,
    endAsked: (key) => endingOf(key).asked.promise,
    ended: (key) => {
      endingOf(key).done.resolve();
    },
  };
}

function jobOf(key: string): Job<string, string> {
  return {
    key,
    module: new URL(`https://workers.example/${key}.ts`),
    envelope: (job) => `job ${job}`,
    decode: (job) => Option.some(`${key} answered job ${String(job)}`),
  };
}

const unbounded = { until: Number.POSITIVE_INFINITY };

describe('the slots of a pool', () => {
  it('admit as many runs at once as the pool has slots, and the next waiting run as one ends, in turn', async () => {
    const slots = poolSlots(1);
    const order: string[] = [];

    expect(await slots.admit(inMs(1000))).toBe('admitted');
    const second = slots.admit(inMs(1000)).then((admission) => order.push(`second ${admission}`));
    const third = slots.admit(inMs(1000)).then((admission) => order.push(`third ${admission}`));
    slots.release();
    await second;
    slots.release();
    await third;
    slots.release();

    expect(order).toEqual(['second admitted', 'third admitted']);
    expect(await slots.admit(inMs(1000))).toBe('admitted');
  });

  it('turn away a run that finds no free slot before its deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const started = performance.now();
    const settled: string[] = [];
    const turnedAway = slots.admit(inMs(20)).then((admission) => settled.push(admission));

    await vi.advanceTimersByTimeAsync(19);
    const whileWaiting = [...settled];
    await vi.advanceTimersByTimeAsync(1);
    await turnedAway;

    expect([whileWaiting, settled]).toEqual([[], ['busy']]);
    expect(performance.now() - started).toBe(20);
  });

  it('turn away a run no sooner than its deadline, though its timer fires before it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = { now: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    onTestFinished(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });
    const slots = poolSlots(1);
    await slots.admit(2000);
    const settled: string[] = [];
    const turnedAway = slots.admit(1050).then((admission) => settled.push(admission));

    await vi.advanceTimersByTimeAsync(50);
    const whileEarly = [...settled];
    clock.now = 1050;
    await vi.advanceTimersByTimeAsync(50);
    await turnedAway;

    expect([whileEarly, settled]).toEqual([[], ['busy']]);
  });
});

describe('a run waiting for a slot', () => {
  it('goes when it is cancelled, and leaves its turn to the next', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const cancelling = new AbortController();
    const cancelled = slots.admit(inMs(1000), cancelling.signal);
    const next = slots.admit(inMs(1000));

    cancelling.abort();
    slots.release();

    expect(await cancelled).toBe('cancelled');
    expect(await next).toBe('admitted');
  });

  it('ignores a cancellation that comes after it was admitted', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const cancelling = new AbortController();
    const admitted = slots.admit(inMs(1000), cancelling.signal);
    slots.release();

    expect(await admitted).toBe('admitted');
    cancelling.abort();
    expect(await admitted).toBe('admitted');
  });

  it('ends when the pool closes, and the pool admits no more', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const waiting = slots.admit(inMs(1000));

    slots.close();

    expect(await waiting).toBe('closing');
    expect(await slots.admit(inMs(1000))).toBe('closing');
  });
});

describe('the program pool', () => {
  it('loads where import.meta.url names no file, reading the module of a worker only as it makes a job of it', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./program-pool.ts', import.meta.url));

    expect(Object.keys(loaded)).toEqual(['checkPermits', 'mostCheckStartMs', 'programPool', 'programPoolOn']);
  });
});

describe('pool instances', () => {
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  describe('a pool whose workers keep their instances between units', () => {
    it('runs each program on a fresh runtime of a kept instance, so nothing one run leaves reaches the next', async () => {
      const pool = keepingPool();

      const runs = [
        await pool.run(
          request('Reflect.set(globalThis, "seen", input);\n  return typeof Reflect.get(globalThis, "seen");'),
        ),
        await pool.run(request('return typeof Reflect.get(globalThis, "seen");')),
      ];

      expect(runs).toMatchObject([
        { ran: 'answered', output: 'number' },
        { ran: 'answered', output: 'undefined' },
      ]);
    });

    it('decides the expressions of an input in its evaluation worker on a kept instance too', async () => {
      const { machine } = keepingPool().evaluations;
      await Effect.runPromise(machine.reserve);
      const unit = machine.unit();
      const decided = unit.evaluate(
        '$data + 1',
        { data: 41 },
        { budget: 250, deadlineAt: machine.clock() + 10_000, moment: 0 },
      );
      unit.close();

      expect(decided).toMatchObject({ ran: 'answered', text: '42' });
    });
  });
});

describe('a job that waits for the pool to let go of an idle worker of another module', () => {
  it('ends cancelled when it is cancelled before the worker has ended, and no worker is started for it', async () => {
    const threads = heldThreads();
    const pool = poolWorkers({ workers: 1 }, threads.start);
    const first = await pool.evaluate(jobOf('first'), unbounded);
    const cancelling = new AbortController();

    const waiting = pool.evaluate(jobOf('second'), { ...unbounded, signal: cancelling.signal });
    await threads.endAsked('first');
    cancelling.abort();
    threads.ended('first');

    expect([first, await waiting]).toEqual(['first answered job 1', stopped('cancelled')]);
    expect(threads.started()).toEqual(['first']);
    await pool.close();
  });
});
