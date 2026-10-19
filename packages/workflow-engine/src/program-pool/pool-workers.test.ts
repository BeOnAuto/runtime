import { Function, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { crashed, stopped } from '../jobs/job-endings.ts';
import type { Job } from '../jobs/pool-job.ts';
import type { StartThread, Thread, ThreadHooks } from './pool-threads.ts';
import { poolWorkers } from './pool-workers.ts';

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
