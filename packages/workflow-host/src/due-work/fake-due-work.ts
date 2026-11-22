import { Effect } from 'effect';

import { signals, type Signals } from '../testing/signals.ts';
import type { SteppedClock } from '../testing/stepped-clock.ts';
import type { DueItem, DueWork } from './due-work.ts';

interface PerformedRow {
  readonly key: string;
  readonly at: number;
  readonly by: string;
}

export interface FakeDueWork {
  readonly work: (by: string) => DueWork;
  readonly add: (key: string, dueAt: number) => void;
  readonly failing: (key: string) => void;
  readonly hanging: (key: string) => void;
  readonly hold: () => void;
  readonly release: () => void;
  readonly local: (key: string) => void;
  readonly endsAt: (key: string, at: number) => void;
  readonly performed: () => readonly PerformedRow[];
  readonly attempts: () => readonly PerformedRow[];
  readonly interrupted: () => readonly string[];
  readonly mostAtOnce: () => number;
  readonly failReads: (times: number) => void;
  readonly reads: () => { readonly due: number; readonly next: number };
  readonly when: Signals['when'];
  readonly changed: () => void;
}

interface StoredRow {
  readonly key: string;
  readonly attemptAt: number | null;
  readonly endsAt: number | null;
}

interface AddedRow {
  readonly key: string;
  readonly dueAt: number;
}

interface DueRow {
  readonly row: StoredRow;
  readonly dueAt: number;
}

interface RowStore {
  readonly add: (key: string, dueAt: number) => void;
  readonly local: (key: string) => void;
  readonly endsAt: (key: string, at: number) => void;
  readonly done: (row: PerformedRow) => void;
  readonly dueBy: (now: number, most: number, callsOut: boolean) => readonly StoredRow[];
  readonly nextAfter: (after: number, callsOut?: boolean) => number | null;
  readonly soonest: (callsOut?: boolean) => number;
  readonly performed: () => readonly PerformedRow[];
}

interface Flight {
  readonly attempt: (row: PerformedRow, sleep: Effect.Effect<void>) => Promise<boolean>;
  readonly failing: (key: string) => void;
  readonly hanging: (key: string) => void;
  readonly hold: () => void;
  readonly release: () => void;
  readonly hangs: (key: string) => boolean;
  readonly attempts: () => readonly PerformedRow[];
  readonly stopped: (key: string) => void;
  readonly interrupted: () => readonly string[];
  readonly most: () => number;
}

function rowStore(changed: () => void): RowStore {
  const added = new Map<string, AddedRow>();
  const locals = new Set<string>();
  const endings = new Map<string, number>();
  const performed: PerformedRow[] = [];
  const rowOf = ({ key, dueAt }: AddedRow): StoredRow =>
    locals.has(key)
      ? { key, attemptAt: null, endsAt: dueAt }
      : { key, attemptAt: dueAt, endsAt: endings.get(key) ?? null };
  const rows = () => [...added.values()].map((row) => rowOf(row));
  const times = (callsOut?: boolean) =>
    rows()
      .flatMap(({ attemptAt, endsAt }) =>
        callsOut === undefined ? [attemptAt, endsAt] : [callsOut ? attemptAt : endsAt],
      )
      .filter((at) => at !== null);
  return {
    add: (key, dueAt) => {
      added.set(key, { key, dueAt });
    },
    local: (key) => {
      locals.add(key);
    },
    endsAt: (key, at) => {
      endings.set(key, at);
    },
    done: (row) => {
      added.delete(row.key);
      performed.push(row);
      changed();
    },
    dueBy: (now, most, callsOut) =>
      rows()
        .flatMap((row): readonly DueRow[] => {
          const dueAt = callsOut ? row.attemptAt : row.endsAt;
          return dueAt !== null && dueAt <= now ? [{ row, dueAt }] : [];
        })
        .toSorted((one, other) => one.dueAt - other.dueAt)
        .slice(0, most)
        .map(({ row }) => row),
    nextAfter: (after, callsOut) => {
      const later = times(callsOut).filter((dueAt) => dueAt > after);
      return later.length === 0 ? null : Math.min(...later);
    },
    soonest: (callsOut) => Math.min(Number.POSITIVE_INFINITY, ...times(callsOut)),
    performed: () => performed,
  };
}

function flight(changed: () => void): Flight {
  const failing = new Set<string>();
  const hanging = new Set<string>();
  const attempts: PerformedRow[] = [];
  const interrupted: string[] = [];
  const counts = { now: 0, most: 0 };
  const holding: { gate?: PromiseWithResolvers<void> } = {};
  return {
    attempt: async (row, sleep) => {
      attempts.push(row);
      counts.now += 1;
      counts.most = Math.max(counts.most, counts.now);
      changed();
      await (holding.gate?.promise ?? Effect.runPromise(sleep));
      counts.now -= 1;
      return failing.has(row.key);
    },
    hold: () => {
      holding.gate = Promise.withResolvers<void>();
    },
    release: () => {
      holding.gate?.resolve();
      delete holding.gate;
    },
    failing: (key) => {
      failing.add(key);
    },
    hanging: (key) => {
      hanging.add(key);
    },
    hangs: (key) => hanging.has(key),
    attempts: () => attempts,
    stopped: (key) => {
      interrupted.push(key);
      changed();
    },
    interrupted: () => interrupted,
    most: () => counts.most,
  };
}

function itemOf(
  store: RowStore,
  flown: Flight,
  row: Omit<PerformedRow, 'at'>,
  {
    performing,
    hung,
    callsOut,
  }: { readonly performing: Effect.Effect<void>; readonly hung: Effect.Effect<never>; readonly callsOut: boolean },
): DueItem {
  return {
    key: row.key,
    callsOut,
    perform: (at) =>
      Effect.promise(() => flown.attempt({ ...row, at }, performing)).pipe(
        Effect.andThen((fails) => (flown.hangs(row.key) ? hung : Effect.succeed(fails))),
        Effect.flatMap((fails) =>
          fails
            ? Effect.fail(new Error(`The row ${row.key} cannot be performed`))
            : Effect.sync(() => {
                store.done({ ...row, at });
              }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            flown.stopped(row.key);
          }),
        ),
      ),
  };
}

export interface FakeOptions {
  readonly reportsRowsInFlight?: boolean;
  readonly nextReadMs?: number;
}

interface CountedReads {
  readonly read: <A>(kind: 'due' | 'next', answer: () => A) => Effect.Effect<A, Error>;
  readonly failReads: (times: number) => void;
  readonly reads: () => { readonly due: number; readonly next: number };
}

function countedReads(changed: () => void): CountedReads {
  const counts = { failing: 0, due: 0, next: 0 };
  return {
    read: (kind, answer) =>
      Effect.suspend(() => {
        counts.failing -= 1;
        return counts.failing < 0
          ? Effect.sync(() => {
              counts[kind] += 1;
              changed();
              return answer();
            })
          : Effect.fail(new Error('The rows are out of reach'));
      }),
    failReads: (times) => {
      counts.failing = times;
    },
    reads: () => ({ due: counts.due, next: counts.next }),
  };
}

/**
 * Due rows on a stepped clock: performing a row takes `performMs` of it, reading when the next is due `nextReadMs`,
 * and a row that hangs waits on work the clock holds, so the loop performing it can still come to rest.
 */
export function fakeDueWork(
  clock: SteppedClock,
  performMs = 0,
  { reportsRowsInFlight = false, nextReadMs = 0 }: FakeOptions = {},
): FakeDueWork {
  const seen = signals();
  const store = rowStore(seen.changed);
  const flown = flight(seen.changed);
  const { read, failReads, reads } = countedReads(seen.changed);
  return {
    work: (by) => ({
      name: 'the fake rows',
      due: (now, most, callsOut) =>
        read('due', () =>
          store.dueBy(now, most, callsOut).map(({ key, endsAt }) =>
            itemOf(
              store,
              flown,
              { key, by },
              {
                performing: clock.sleep(performMs),
                hung: Effect.andThen(clock.hold().wait, Effect.never),
                callsOut: endsAt === null || endsAt > now,
              },
            ),
          ),
        ),
      nextDueAt: (after, callsOut) =>
        Effect.andThen(
          clock.sleep(nextReadMs),
          read('next', () => (reportsRowsInFlight ? store.soonest(callsOut) : store.nextAfter(after, callsOut))),
        ),
    }),
    add: store.add,
    failing: flown.failing,
    hanging: flown.hanging,
    hold: flown.hold,
    release: flown.release,
    local: store.local,
    endsAt: store.endsAt,
    performed: store.performed,
    attempts: flown.attempts,
    interrupted: flown.interrupted,
    mostAtOnce: flown.most,
    failReads,
    reads,
    ...seen,
  };
}
