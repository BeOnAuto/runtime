import { AsyncLocalStorage } from 'node:async_hooks';

import { DumboError } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import type { ReadonlyAbortContext } from '../client/readonly-options.ts';
import { settled } from '../testing/clients.ts';
import { notStartedInTime, tooManyWaiting, writerClosed, writerQueue } from './writer-queue.ts';

const todaysBounds = { mostWaiting: 1000, longestWaitToStart: 30_000 };

interface Held {
  readonly task: (context: ReadonlyAbortContext) => Promise<string>;
  readonly started: Promise<ReadonlyAbortContext>;
  readonly letGo: () => void;
}

function aHeldTask(): Held {
  const started = Promise.withResolvers<ReadonlyAbortContext>();
  const letGo = Promise.withResolvers<void>();
  return {
    task: async (context) => {
      started.resolve(context);
      await letGo.promise;
      return 'answered';
    },
    started: started.promise,
    letGo: () => {
      letGo.resolve();
    },
  };
}

function noted(notes: { readonly push: (note: string) => number }, note: string): () => Promise<string> {
  return () => {
    notes.push(note);
    return Promise.resolve(note);
  };
}

describe('the queue of the one writer, as it runs its tasks', () => {
  it('runs one task at a time, first in first out', async () => {
    const queue = writerQueue(todaysBounds);
    const order: string[] = [];
    const first = aHeldTask();

    const answers = Promise.all([
      queue.run(first.task),
      queue.run(noted(order, 'second')),
      queue.run(noted(order, 'third')),
    ]);
    await first.started;
    order.push('the first holds the writer');
    first.letGo();

    expect(await answers).toEqual(['answered', 'second', 'third']);
    expect(order).toEqual(['the first holds the writer', 'second', 'third']);
  });

  it('starts a task in the async context of its caller', async () => {
    const queue = writerQueue(todaysBounds);
    const context = new AsyncLocalStorage<string>();
    const first = aHeldTask();

    const holding = queue.run(first.task);
    const seen = context.run('the caller', () => queue.run(() => Promise.resolve(context.getStore())));
    first.letGo();
    await holding;

    expect(await seen).toBe('the caller');
  });

  it('hands a task that fails its failure, and runs the next', async () => {
    const queue = writerQueue(todaysBounds);
    const failure = new Error('failed');

    const failed = await settled(queue.run(() => Promise.reject(failure)));

    expect(failed).toEqual({ status: 'rejected', reason: failure });
    expect(await queue.run(() => Promise.resolve('next'))).toBe('next');
  });
});

describe('the bounds of the queue of the one writer', () => {
  it('refuse a task once as many are waiting as it holds, in today’s words', async () => {
    const queue = writerQueue({ ...todaysBounds, mostWaiting: 2 });
    const first = aHeldTask();
    const running = queue.run(first.task);
    const waiting = [queue.run(() => Promise.resolve('second')), queue.run(() => Promise.resolve('third'))];

    const refusal = await settled(queue.run(() => Promise.resolve('fourth')));
    first.letGo();

    expect(refusal).toEqual({ status: 'rejected', reason: new DumboError(tooManyWaiting) });
    expect(await Promise.all([running, ...waiting])).toEqual(['answered', 'second', 'third']);
  });

  it('refuse a task that did not start within the longest wait, in today’s words, and keep the place of the rest', async () => {
    const queue = writerQueue({ ...todaysBounds, longestWaitToStart: 20 });
    const first = aHeldTask();
    const running = queue.run(first.task);

    const refusal = await settled(queue.run(() => Promise.resolve('late')));
    first.letGo();

    expect(refusal).toEqual({ status: 'rejected', reason: new DumboError(notStartedInTime) });
    expect(await running).toBe('answered');
    expect(await queue.run(() => Promise.resolve('next'))).toBe('next');
  });
});

describe('a task of the queue of the one writer that its caller aborts', () => {
  it('is refused before it is queued when its caller has already aborted', async () => {
    const queue = writerQueue(todaysBounds);
    const reason = new Error('aborted');

    const refusal = await settled(
      queue.run(() => Promise.resolve('never'), { abort: { signal: AbortSignal.abort(reason) } }),
    );

    expect(refusal).toEqual({ status: 'rejected', reason });
  });

  it('leaves the queue while it waits, and the next task takes its place', async () => {
    const queue = writerQueue(todaysBounds);
    const first = aHeldTask();
    const controller = new AbortController();
    const reason = new Error('aborted');
    const ran: string[] = [];
    const running = queue.run(first.task);
    const aborted = settled(queue.run(noted(ran, 'aborted'), { abort: controller }));
    const next = queue.run(noted(ran, 'next'));

    controller.abort(reason);
    first.letGo();

    expect([await aborted, await running, await next]).toEqual([{ status: 'rejected', reason }, 'answered', 'next']);
    expect(ran).toEqual(['next']);
  });
});

describe('a running task of the queue of the one writer that its caller aborts', () => {
  it('answers its caller at once while it runs, and holds the writer until it ends', async () => {
    const queue = writerQueue(todaysBounds);
    const first = aHeldTask();
    const controller = new AbortController();
    const reason = new Error('aborted');
    const ran: string[] = [];
    const running = settled(queue.run(first.task, { abort: controller }));
    const next = queue.run(noted(ran, 'next'));
    const context = await first.started;

    controller.abort(reason);
    const answered = await running;
    ran.push('the caller is answered');
    first.letGo();

    expect([answered, context.abort.signal.aborted, await next]).toEqual([
      { status: 'rejected', reason },
      true,
      'next',
    ]);
    expect(ran).toEqual(['the caller is answered', 'next']);
  });
});

describe('the queue of the one writer, as its pool closes', () => {
  it('refuses what waits, waits for what runs, and refuses what comes after', async () => {
    const queue = writerQueue(todaysBounds);
    const first = aHeldTask();
    const running = queue.run(first.task);
    const waiting = settled(queue.run(() => Promise.resolve('waiting')));
    await first.started;

    const stopped = queue.stop();
    const refusals = [await waiting, await settled(queue.run(() => Promise.resolve('later')))];
    first.letGo();
    await stopped;
    await queue.stop();

    const closed = { status: 'rejected', reason: new DumboError(writerClosed) };
    expect(refusals).toEqual([closed, closed]);
    expect(await running).toBe('answered');
  });

  it('waits for nothing when forced, and aborts what runs', async () => {
    const queue = writerQueue(todaysBounds);
    const first = aHeldTask();
    const running = settled(queue.run(first.task));
    const context = await first.started;

    await queue.stop({ force: true });

    expect([await running, context.abort.signal.aborted]).toEqual([
      { status: 'rejected', reason: new DumboError(writerClosed) },
      true,
    ]);
    first.letGo();
  });
});

describe('the queue of the one writer, as its pool closes within a deadline', () => {
  it('waits for what runs no longer than its deadline', async () => {
    const queue = writerQueue(todaysBounds);
    const first = aHeldTask();
    const running = queue.run(first.task);
    await first.started;
    const began = performance.now();

    await queue.stop({ closeDeadline: 20 });

    expect(performance.now() - began).toBeGreaterThanOrEqual(19);
    first.letGo();
    expect(await running).toBe('answered');
  });

  it('closes at once when nothing runs, even when forced', async () => {
    const queue = writerQueue(todaysBounds);

    await queue.stop({ force: true });

    expect(await settled(queue.run(() => Promise.resolve('later')))).toEqual({
      status: 'rejected',
      reason: new DumboError(writerClosed),
    });
  });
});
