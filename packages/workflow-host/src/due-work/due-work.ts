import { Effect, Semaphore } from 'effect';

import { background } from '../calls/background.ts';
import type { Trouble } from '../calls/host-executor.ts';
import type { HostContext } from '../loop/forked-fibers.ts';
import { rowWaits, type RowWaits } from './row-waits.ts';

export interface DueItem {
  readonly key: string;
  readonly callsOut: boolean;
  readonly perform: (now: number) => Effect.Effect<void, unknown>;
}

export interface DueWork {
  readonly name: string;
  readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly DueItem[], unknown>;
  readonly nextDueAt: (after: number) => Effect.Effect<number | null, unknown>;
}

export interface DuePerformer {
  readonly performed: (now: number) => Effect.Effect<void>;
  readonly wakeAt: (now: number) => Effect.Effect<number>;
  readonly stop: () => Effect.Effect<void>;
}

export interface DueParts {
  readonly trouble: Trouble;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Effect.Effect<void>;
  readonly wake: () => void;
  readonly context?: HostContext;
}

export const dueInOneWakeUp = 256;

export const duePerformedAtOnce = 16;

export const dueAwaitedMs = 1000;

function itemPerformer(work: DueWork, waits: RowWaits, { trouble, now }: DueParts) {
  return (item: DueItem): Effect.Effect<void> =>
    Effect.suspend(() => {
      const at = now();
      return item.perform(at).pipe(
        Effect.withSpan(`due ${work.name}`, { attributes: { 'auto.on.due.key': item.key } }),
        Effect.andThen(
          Effect.sync(() => {
            waits.performed(item.key);
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.andThen(
            Effect.sync(() => {
              waits.failed(item.key, at);
            }),
            trouble(`A due row of ${work.name} could not be performed; the loop tries it again after a wait`, cause),
          ),
        ),
      );
    });
}

function awaitedAtMost(handedOut: Effect.Effect<void>, { sleep }: DueParts): Effect.Effect<void> {
  return Effect.interruptible(Effect.raceFirst(handedOut, sleep(dueAwaitedMs)));
}

function laterThan(now: number, next: number | null): number {
  return next === null || next <= now ? Number.POSITIVE_INFINITY : next;
}

interface Lane {
  readonly has: (key: string) => boolean;
  readonly size: () => number;
  readonly mostInFlight: number;
  readonly handed: (ready: readonly DueItem[]) => readonly string[];
  readonly leftWithRoom: () => boolean;
  readonly awaited: (keys: readonly string[]) => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

interface LaneParts {
  readonly performed: (item: DueItem) => Effect.Effect<void>;
  readonly finished: Effect.Effect<void>;
  readonly mostInFlight: number;
  readonly context: HostContext;
}

function laneOf({ performed, finished, mostInFlight, context }: LaneParts): Lane {
  const running = background(context);
  const atOnce = Semaphore.makeUnsafe(duePerformedAtOnce);
  const backlog = { more: false };
  return {
    has: running.has,
    size: running.size,
    mostInFlight,
    handed: (ready) => {
      const given = ready.slice(0, Math.max(0, mostInFlight - running.size()));
      backlog.more = ready.length > given.length;
      for (const item of given) {
        running.run(item.key, atOnce.withPermit(performed(item)).pipe(Effect.ensuring(finished)));
      }
      return given.map(({ key }) => key);
    },
    leftWithRoom: () => backlog.more && running.size() < mostInFlight,
    awaited: running.awaited,
    stop: running.stop,
  };
}

function nextWakeOf(work: DueWork, waits: RowWaits, { trouble }: DueParts, now: number): Effect.Effect<number> {
  return work.nextDueAt(now).pipe(
    Effect.map((next) => Math.min(laterThan(now, next), waits.nextUntil(now))),
    Effect.catchCause((cause) =>
      Effect.as(
        trouble(`The next due time of ${work.name} could not be read; the loop waits for the next sweep`, cause),
        Number.POSITIVE_INFINITY,
      ),
    ),
  );
}

function workPerformer(work: DueWork, parts: DueParts): DuePerformer {
  const waits = rowWaits();
  const performedItem = itemPerformer(work, waits, parts);
  const finished = Effect.sync(() => {
    parts.wake();
  });
  const outbound = laneOf({
    performed: performedItem,
    finished,
    mostInFlight: duePerformedAtOnce,
    context: parts.context,
  });
  const local = laneOf({ performed: performedItem, finished, mostInFlight: dueInOneWakeUp, context: parts.context });
  const lanes = [outbound, local];
  const handedOut = (items: readonly DueItem[], now: number): readonly string[] => {
    const ready = [...new Map(items.map((item) => [item.key, item])).values()].filter(
      ({ key }) => !waits.holds(key, now) && !lanes.some((lane) => lane.has(key)),
    );
    return [
      ...outbound.handed(ready.filter(({ callsOut }) => callsOut)),
      ...local.handed(ready.filter(({ callsOut }) => !callsOut)),
    ];
  };
  const readOf = (now: number, lane: Lane, callsOut: boolean) =>
    work.due(now, 2 * lane.mostInFlight + 1 + waits.heldAt(now) + outbound.size() + local.size(), callsOut);
  return {
    performed: (now) =>
      Effect.zipWith(readOf(now, outbound, true), readOf(now, local, false), (outward, inward) =>
        handedOut([...outward, ...inward], now),
      ).pipe(
        Effect.flatMap((keys) => awaitedAtMost(local.awaited(keys), parts)),
        Effect.catchCause((cause) =>
          parts.trouble(`The due rows of ${work.name} could not be read; the loop tries again`, cause),
        ),
      ),
    wakeAt: (now) =>
      lanes.some((lane) => lane.leftWithRoom()) ? Effect.succeed(now) : nextWakeOf(work, waits, parts, now),
    stop: () => Effect.all([outbound.stop(), local.stop()], { discard: true }),
  };
}

export function duePerformer(works: readonly DueWork[], parts: DueParts): DuePerformer {
  const performers = works.map((work) => workPerformer(work, parts));
  return {
    performed: (now) =>
      Effect.forEach(performers, ({ performed }) => performed(now), { concurrency: 'unbounded', discard: true }),
    wakeAt: (now) =>
      Effect.map(
        Effect.forEach(performers, ({ wakeAt }) => wakeAt(now)),
        (wakes: readonly number[]) => Math.min(Number.POSITIVE_INFINITY, ...wakes),
      ),
    stop: () => Effect.forEach(performers, ({ stop }) => stop(), { discard: true }),
  };
}
