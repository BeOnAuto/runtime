import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { followedRecordOf } from '../reaction-testing/followed-records.ts';
import { DeliveryFailed, boundTo, type RecordConsumer, type Delivery } from './consumers.ts';
import { deliveredAll } from './delivery-loop.ts';
import type { Progress } from './followed-playbooks.ts';

const followed = followedRecordOf(null);

const fresh: Progress = { cursor: null, delivered: null, attempts: 0, waiting: false };

interface Counted {
  readonly consumer: RecordConsumer;
  readonly delivered: () => readonly string[];
  readonly skipped: () => readonly string[];
}

function boundAll(...consumers: readonly RecordConsumer[]) {
  return consumers.map((consumer) => boundTo(consumer, followed));
}

function keyed(index: number): string {
  return String(index).padStart(4, '0');
}

function counted(
  name: string,
  count: number,
  failing: ReadonlySet<string> = new Set(),
  delivers: (key: string) => boolean = () => true,
): Counted {
  const delivered: string[] = [];
  const skipped: string[] = [];
  const deliveryOf = (key: string): Delivery => ({
    key,
    workflow: 'close',
    deliver: failing.has(key)
      ? Effect.fail(new DeliveryFailed({ detail: `${key} failed` }))
      : Effect.sync(() => {
          delivered.push(`${name} ${key}`);
        }),
    skipped: (detail) =>
      Effect.sync(() => {
        skipped.push(`${key}: ${detail}`);
      }),
  });
  const keys = Array.from({ length: count }, (_, index) => keyed(index));
  return {
    consumer: {
      name,
      skippedAfterSweeps: 20,
      batchOf: (_record, after, most) =>
        Effect.sync(() => {
          const left = keys.filter((key) => after === undefined || key > after);
          const taken = left.slice(0, most);
          return {
            deliveries: taken.filter((key) => delivers(key)).map((key) => deliveryOf(key)),
            through: taken.at(-1),
            more: left.length > most,
          };
        }),
    },
    delivered: () => delivered,
    skipped: () => skipped,
  };
}

describe('the deliveries of one record', () => {
  it('are 100 in a pass at most, the rest following in the next pass from the last delivered, consumer by consumer', async () => {
    const listeners = counted('listeners', 120);
    const starts = counted('starts', 30);
    const consumers = boundAll(listeners.consumer, starts.consumer);

    const first = await Effect.runPromise(deliveredAll(consumers, fresh, 'signal'));
    const second = await Effect.runPromise(deliveredAll(consumers, first.progress, 'signal'));

    expect([first.end, listeners.delivered().length, second.end, starts.delivered().length]).toEqual([
      'more',
      120,
      undefined,
      30,
    ]);
    expect(listeners.delivered().slice(99, 101)).toEqual(['listeners 0099', 'listeners 0100']);
  });

  it('try a delivery that keeps failing on 20 sweeps, holding the record, then skip it and say so', async () => {
    const starts = counted('starts', 3, new Set(['0001']));
    const swept = (progress: Progress) => deliveredAll(boundAll(starts.consumer), progress, 'sweep');

    const signalled = await Effect.runPromise(deliveredAll(boundAll(starts.consumer), fresh, 'signal'));
    const held = await Effect.runPromise(
      Array.from({ length: 19 }).reduce<Effect.Effect<Progress>>(
        (before) => Effect.flatMap(before, (progress) => Effect.map(swept(progress), (step) => step.progress)),
        Effect.succeed(signalled.progress),
      ),
    );
    const last = await Effect.runPromise(swept(held));

    expect([signalled.end, signalled.progress.attempts, held.attempts, last.end]).toEqual([
      'waiting',
      0,
      19,
      undefined,
    ]);
    expect([starts.delivered(), starts.skipped()]).toEqual([['starts 0000', 'starts 0002'], ['0001: 0001 failed']]);
  });

  it('ask a consumer again within the pass, from where its last batch ended, while its batches deliver fewer than they take', async () => {
    const sparse = counted('sparse', 298, new Set(), (key) => Number(key) % 3 === 0);

    const pass = await Effect.runPromise(deliveredAll(boundAll(sparse.consumer), fresh, 'signal'));

    expect([pass.end, sparse.delivered().length, sparse.delivered().at(-1)]).toEqual([undefined, 100, 'sparse 0297']);
  });
});
