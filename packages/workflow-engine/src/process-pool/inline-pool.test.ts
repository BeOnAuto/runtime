import { describe, expect, it } from 'vitest';

import { until } from '../pool-testing/waiting.ts';
import { inlinePool, type InlineRequest } from './inline-pool.ts';
import type { ProcessHandlers } from './process-loop.ts';
import type { ProcessValue } from './process-values.ts';

interface Held {
  readonly handlers: ProcessHandlers;
  readonly free: () => void;
  readonly signals: readonly Readonly<AbortSignal>[];
}

const shortMs = 40;

const longMs = 5_000;

function heldUntilFreed(): Held {
  const signals: Readonly<AbortSignal>[] = [];
  const freed = Promise.withResolvers<ProcessValue>();
  return {
    signals,
    free: () => {
      freed.resolve('freed');
    },
    handlers: {
      hold: (_payload, signal) => {
        if (signal !== undefined) {
          signals.push(signal);
        }
        return freed.promise;
      },
      echo: (payload) => ({ echoed: payload }),
    },
  };
}

function request(kind: string, deadlineMs: number, long = false): InlineRequest {
  return { kind, payload: { asked: kind }, deadlineMs, long };
}

describe('a pool that serves jobs in the process that asks', () => {
  it('answers what the handler of the kind answers, with how long it took', async () => {
    const pool = inlinePool({ jobs: 2, longJobs: 1, handlers: { echo: (payload) => ({ echoed: payload }) } });

    const { milliseconds, ...ending } = await pool.run(request('echo', longMs));

    expect(ending).toEqual({ ended: 'answered', answer: { echoed: { asked: 'echo' } } });
    expect([milliseconds >= 0, pool.jobs, pool.longJobs]).toEqual([true, 2, 1]);
  });

  it('ends a job that throws as crashed, one that cannot allocate as out of memory, and a kind it does not serve as crashed', async () => {
    const pool = inlinePool({
      jobs: 1,
      longJobs: 1,
      handlers: {
        throws: () => {
          throw new Error('The model broke');
        },
        allocates: () => Promise.reject(new RangeError('Array buffer allocation failed')),
      },
    });

    const outcomes = await Promise.all(
      ['throws', 'allocates', 'unknown'].map(async (kind) => {
        const { milliseconds: _milliseconds, ...ending } = await pool.run(request(kind, longMs));
        return ending;
      }),
    );

    expect(outcomes).toEqual([
      { ended: 'crashed', detail: 'Error: The model broke' },
      { ended: 'out_of_memory' },
      { ended: 'crashed', detail: 'This pool serves no job of the kind unknown' },
    ]);
  });
});

describe('the bounds of a job in the pool that serves it in the process that asks', () => {
  it('time a job out at its deadline, abort the signal its handler holds, and keep its lane until the handler settles', async () => {
    const held = heldUntilFreed();
    const pool = inlinePool({ jobs: 1, longJobs: 1, handlers: held.handlers });

    const timedOut = await pool.run(request('hold', shortMs));
    const waited = await pool.run(request('echo', shortMs));
    held.free();
    const after = await pool.run(request('echo', longMs));

    expect([timedOut.ended, held.signals.map(({ aborted }) => aborted)]).toEqual(['timed_out', [true]]);
    expect([waited.ended, after.ended]).toEqual(['busy', 'answered']);
  });

  it('cancel a job whose caller aborts while it runs, or before it is admitted', async () => {
    const held = heldUntilFreed();
    const pool = inlinePool({ jobs: 1, longJobs: 1, handlers: held.handlers });
    const running = new AbortController();
    const aborted = new AbortController();
    aborted.abort();

    const asked = pool.run(request('hold', longMs), running.signal);
    await until(() => held.signals.length === 1);
    running.abort();
    const cancelled = await asked;
    held.free();
    const early = await pool.run(request('echo', longMs), aborted.signal);

    expect([cancelled.ended, early.ended, held.signals.map(({ aborted: was }) => was)]).toEqual([
      'cancelled',
      'cancelled',
      [true],
    ]);
  });
});

describe('the lanes of the pool that serves jobs in the process that asks', () => {
  it('hold at most its long jobs at once, each in a lane, beside the jobs that are not long', async () => {
    const held = heldUntilFreed();
    const pool = inlinePool({ jobs: 2, longJobs: 1, handlers: held.handlers });

    const first = pool.run(request('hold', longMs, true));
    const second = await pool.run(request('echo', shortMs, true));
    const short = await pool.run(request('echo', longMs));
    held.free();

    expect([second.ended, short.ended, (await first).ended]).toEqual(['busy', 'answered', 'answered']);
  });

  it('let the long lane go when no lane frees in time for a long job', async () => {
    const held = heldUntilFreed();
    const pool = inlinePool({ jobs: 1, longJobs: 1, handlers: held.handlers });

    const holding = pool.run(request('hold', longMs));
    const crowded = await pool.run(request('echo', shortMs, true));
    held.free();
    await holding;
    const freed = await pool.run(request('echo', longMs, true));

    expect([crowded.ended, freed.ended]).toEqual(['busy', 'answered']);
  });

  it('close, ending the jobs that wait for a lane and refusing new ones', async () => {
    const held = heldUntilFreed();
    const pool = inlinePool({ jobs: 1, longJobs: 1, handlers: held.handlers });

    const holding = pool.run(request('hold', longMs));
    const waiting = pool.run(request('echo', longMs));
    await until(() => held.signals.length === 1);
    pool.close();
    const refused = await pool.run(request('echo', longMs));
    held.free();

    expect([(await waiting).ended, refused.ended, (await holding).ended]).toEqual(['closing', 'closing', 'answered']);
  });
});
