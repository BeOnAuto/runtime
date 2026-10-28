import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';

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
  readonly attempt: (row: PerformedRow, performMs: number) => Promise<boolean>;
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

function rowStore(): RowStore {
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

function flight(): Flight {
  const failing = new Set<string>();
  const hanging = new Set<string>();
  const attempts: PerformedRow[] = [];
  const interrupted: string[] = [];
  const counts = { now: 0, most: 0 };
  const holding: { gate?: PromiseWithResolvers<void> } = {};
  return {
    attempt: async (row, performMs) => {
      attempts.push(row);
      counts.now += 1;
      counts.most = Math.max(counts.most, counts.now);
      await (holding.gate?.promise ?? setTimeout(performMs));
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
    },
    interrupted: () => interrupted,
    most: () => counts.most,
  };
}

function itemOf(
  store: RowStore,
  flown: Flight,
  row: Omit<PerformedRow, 'at'>,
  { performMs, callsOut }: { readonly performMs: number; readonly callsOut: boolean },
): DueItem {
  return {
    key: row.key,
    callsOut,
    perform: (at) =>
      Effect.promise(() => flown.attempt({ ...row, at }, performMs)).pipe(
        Effect.andThen((fails) => (flown.hangs(row.key) ? Effect.never : Effect.succeed(fails))),
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

export function fakeDueWork(
  performMs = 0,
  { reportsRowsInFlight = false, nextReadMs = 0 }: FakeOptions = {},
): FakeDueWork {
  const store = rowStore();
  const flown = flight();
  const reads = { failing: 0, due: 0, next: 0 };
  const read = <A>(answer: () => A): Effect.Effect<A, Error> =>
    Effect.suspend(() => {
      reads.failing -= 1;
      return reads.failing < 0 ? Effect.sync(answer) : Effect.fail(new Error('The rows are out of reach'));
    });
  return {
    work: (by) => ({
      name: 'the fake rows',
      due: (now, most, callsOut) =>
        read(() => {
          reads.due += 1;
          return store
            .dueBy(now, most, callsOut)
            .map(({ key, endsAt }) =>
              itemOf(store, flown, { key, by }, { performMs, callsOut: endsAt === null || endsAt > now }),
            );
        }),
      nextDueAt: (after, callsOut) =>
        Effect.andThen(
          Effect.sleep(nextReadMs),
          read(() => {
            reads.next += 1;
            return reportsRowsInFlight ? store.soonest(callsOut) : store.nextAfter(after, callsOut);
          }),
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
    failReads: (times) => {
      reads.failing = times;
    },
    reads: () => ({ due: reads.due, next: reads.next }),
  };
}
