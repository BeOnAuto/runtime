import type { AppendSignal } from '@on.auto/ledger';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import type { SomeFolder } from '../projector/folder.ts';
import { startProjector, type Projector } from '../projector/projector.ts';

export type { Projector } from '../projector/projector.ts';

export interface ProjectingOptions {
  readonly sweepEveryMs?: number;
  readonly pagesPerWake?: number;
  readonly playbooksAtOnce?: number;
  readonly through?: (database: HostDatabase) => HostDatabase;
  readonly clock?: HostClock;
}

export interface WhenFolded {
  <A, B extends A>(read: () => Promise<A>, holds: (value: A) => value is B): Promise<B>;
  <A>(read: () => Promise<A>, holds: (value: A) => boolean): Promise<A>;
}

function asItIs(database: HostDatabase): HostDatabase {
  return database;
}

export interface Folding {
  readonly whenFolded: WhenFolded;
  readonly rested: () => void;
}

export function folding(): Folding {
  const waiting = new Set<() => Promise<boolean>>();
  const checked = (check: () => Promise<boolean>) => {
    void check().then((done) => (done ? waiting.delete(check) : false));
  };
  function whenFolded<A, B extends A>(read: () => Promise<A>, holds: (value: A) => value is B): Promise<B>;
  function whenFolded<A>(read: () => Promise<A>, holds: (value: A) => boolean): Promise<A>;
  function whenFolded<A>(read: () => Promise<A>, holds: (value: A) => boolean): Promise<A> {
    const { promise, resolve } = Promise.withResolvers<A>();
    const check = async (): Promise<boolean> => {
      const value = await read();
      if (!holds(value)) {
        return false;
      }
      resolve(value);
      return true;
    };
    waiting.add(check);
    checked(check);
    return promise;
  }
  return {
    whenFolded,
    rested: () => {
      for (const check of waiting) {
        checked(check);
      }
    },
  };
}

export function restingOn(clock: HostClock, rested: () => void): HostClock {
  return {
    now: clock.now,
    sleep: (milliseconds) => Effect.andThen(Effect.sync(rested), clock.sleep(milliseconds)),
  };
}

interface ProjectorFor {
  readonly database: HostDatabase;
  readonly folders: readonly SomeFolder[];
  readonly appends: AppendSignal;
  readonly reports: HostReports;
  readonly folded: Folding;
}

export function projectorOf(
  { database, folders, appends, reports, folded }: ProjectorFor,
  {
    sweepEveryMs = 50,
    pagesPerWake = 10,
    playbooksAtOnce = 4,
    through = asItIs,
    clock = systemClock,
  }: ProjectingOptions = {},
): Projector {
  return startProjector({
    database: through(database),
    settings: { folders, playbooksAtOnce, pagesPerWake, appends },
    reports,
    clock,
    pace: restingOn(clock, folded.rested),
    sweepEveryMs,
  });
}
