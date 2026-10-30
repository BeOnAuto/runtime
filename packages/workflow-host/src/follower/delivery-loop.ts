import { Effect, Result, Schema } from 'effect';

import { deliveriesOfARecordInAPass, type BoundConsumer, type Delivery } from './consumers.ts';
import type { Progress } from './followed-playbooks.ts';

export type Mode = 'signal' | 'sweep';

interface Delivered {
  readonly progress: Progress;
  readonly end?: 'waiting' | 'more';
}

interface Resumption {
  readonly first: number;
  readonly after: string | undefined;
}

const MarkerSchema = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

function resumptionOf(consumers: readonly BoundConsumer[], delivered: string | null): Resumption {
  if (delivered === null) {
    return { first: 0, after: undefined };
  }
  const [consumer, key] = Schema.decodeUnknownSync(MarkerSchema)(delivered);
  return {
    first: Math.max(
      0,
      consumers.findIndex(({ name }) => name === consumer),
    ),
    after: key,
  };
}

function textOf(consumer: string, key: string): string {
  return JSON.stringify([consumer, key]);
}

function deliveredOne(
  mode: Mode,
  consumer: BoundConsumer,
  delivery: Delivery,
  progress: Progress,
): Effect.Effect<Delivered> {
  return Effect.gen(function* () {
    const done = yield* Effect.result(delivery.deliver);
    if (Result.isSuccess(done)) {
      return { progress: { ...progress, delivered: textOf(consumer.name, delivery.key), attempts: 0 } };
    }
    const attempts = mode === 'sweep' ? progress.attempts + 1 : progress.attempts;
    if (attempts < consumer.skippedAfterSweeps) {
      return { progress: { ...progress, attempts, waiting: true }, end: 'waiting' };
    }
    yield* delivery.skipped(done.failure.detail);
    return { progress: { ...progress, delivered: textOf(consumer.name, delivery.key), attempts: 0 } };
  });
}

function deliveredByConsumer(
  mode: Mode,
  consumer: BoundConsumer,
  start: { readonly progress: Progress; readonly after: string | undefined; readonly budget: number },
): Effect.Effect<Delivered & { readonly budget: number }> {
  return Effect.gen(function* () {
    let { progress, after, budget } = start;
    for (;;) {
      const batch = yield* consumer.batchOf(after, budget);
      for (const delivery of batch.deliveries) {
        const delivered = yield* deliveredOne(mode, consumer, delivery, progress);
        progress = delivered.progress;
        budget -= 1;
        if (delivered.end !== undefined) {
          return { ...delivered, budget };
        }
      }
      progress =
        batch.through === undefined ? progress : { ...progress, delivered: textOf(consumer.name, batch.through) };
      if (!batch.more) {
        return { progress, budget };
      }
      if (budget <= 0) {
        return { progress: { ...progress, waiting: true }, end: 'more', budget };
      }
      after = batch.through;
    }
  });
}

interface DeliveredAll extends Delivered {
  readonly made: boolean;
}

export function deliveredAll(
  consumers: readonly BoundConsumer[],
  progress: Progress,
  mode: Mode,
): Effect.Effect<DeliveredAll> {
  return Effect.gen(function* () {
    const { first, after: resumedAfter } = resumptionOf(consumers, progress.delivered);
    let current: Delivered & { readonly budget: number } = { progress, budget: deliveriesOfARecordInAPass };
    for (const [offset, consumer] of consumers.slice(first).entries()) {
      const after = offset === 0 ? resumedAfter : undefined;
      current = yield* deliveredByConsumer(mode, consumer, { ...current, after });
      if (current.end !== undefined) {
        return { progress: current.progress, end: current.end, made: current.budget < deliveriesOfARecordInAPass };
      }
    }
    return { progress: current.progress, made: current.budget < deliveriesOfARecordInAPass };
  });
}
