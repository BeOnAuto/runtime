import type { FoldOutcome, ProgramPool } from '@on.auto/workflow-engine/dsl';

import type { HostDatabase } from '../database/host-database.ts';

export interface FaultyPool {
  readonly pool: ProgramPool;
  readonly folds: () => number;
}

export interface Overrunning {
  readonly pool: ProgramPool;
  readonly overrunNext: () => void;
}

export interface Held<Gated> {
  readonly gated: Gated;
  readonly waiting: () => number;
  readonly most: () => number;
  readonly total: () => number;
  readonly open: () => void;
}

function firstFoldOf(pool: ProgramPool, first: () => Promise<FoldOutcome>): FaultyPool {
  const counted = { folds: 0 };
  return {
    pool: {
      ...pool,
      fold: (request, signal) => {
        counted.folds += 1;
        return counted.folds === 1 ? first() : pool.fold(request, signal);
      },
    },
    folds: () => counted.folds,
  };
}

export function failingOnce(pool: ProgramPool): FaultyPool {
  return firstFoldOf(pool, () => Promise.reject(new Error('The pool was told to fail')));
}

export function busyOnce(pool: ProgramPool): FaultyPool {
  return firstFoldOf(pool, () => Promise.resolve({ ran: 'stopped', because: 'busy', milliseconds: 0 }));
}

export function racingOnce(pool: ProgramPool, race: () => Promise<unknown>): ProgramPool {
  const raced = { done: false };
  return {
    ...pool,
    fold: async (request, signal) => {
      const outcome = await pool.fold(request, signal);
      if (!raced.done) {
        raced.done = true;
        await race();
      }
      return outcome;
    },
  };
}

export function overrunningWhenTold(pool: ProgramPool): Overrunning {
  const told = { overrun: false };
  return {
    pool: {
      ...pool,
      fold: (request, signal) => {
        if (!told.overrun) {
          return pool.fold(request, signal);
        }
        told.overrun = false;
        const views = request.views.map(({ events: [first = 0] }) => ({
          view: null,
          folded: 0,
          lastFolded: -1,
          through: -1,
          work: 0,
          overtime: first,
        }));
        return Promise.resolve({ ran: 'folded', early: false, views, milliseconds: 0 });
      },
    },
    overrunNext: () => {
      told.overrun = true;
    },
  };
}

export function secondFoldWithBudget(pool: ProgramPool, pageBudgetMs: number): ProgramPool {
  const counted = { folds: 0 };
  return {
    ...pool,
    fold: (request, signal) => {
      counted.folds += 1;
      return pool.fold(counted.folds === 2 ? { ...request, pageBudgetMs } : request, signal);
    },
  };
}

function held<Gated>(gate: (wait: () => Promise<void>) => Gated): Held<Gated> {
  const opened = Promise.withResolvers<void>();
  const counts = { waiting: 0, most: 0, total: 0 };
  const wait = async (): Promise<void> => {
    counts.total += 1;
    counts.waiting += 1;
    counts.most = Math.max(counts.most, counts.waiting);
    await opened.promise;
    counts.waiting -= 1;
  };
  return {
    gated: gate(wait),
    waiting: () => counts.waiting,
    most: () => counts.most,
    total: () => counts.total,
    open: () => {
      opened.resolve();
    },
  };
}

export function heldReads(database: HostDatabase): Held<HostDatabase> {
  return held((wait) => ({
    ...database,
    store: {
      ...database.store,
      readRecorded: async (playbookKey, selection, page) => {
        await wait();
        return database.store.readRecorded(playbookKey, selection, page);
      },
    },
  }));
}

export function heldFolds(pool: ProgramPool): Held<ProgramPool> {
  return held((wait) => ({
    ...pool,
    fold: async (request, signal) => {
      await wait();
      return pool.fold(request, signal);
    },
  }));
}
