import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HostClock } from '../loop/host-clock.ts';
import { startProjector, type Projector } from '../projector/projector.ts';
import { fewSweeps, steppedBy, steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
import type { ViewSettingsOf, ViewsProjecting } from './view-documents.ts';

interface CountingDatabase {
  readonly database: HostDatabase;
  readonly reads: () => number;
  readonly failingDiscovery: (fails: boolean) => void;
}

function countingDatabase(database: HostDatabase): CountingDatabase {
  const counted = { reads: 0, failingDiscovery: false };
  const { store } = database;
  return {
    database: {
      ...database,
      store: {
        ...store,
        readRecordedOfKeys: (keys, selection, page) => {
          counted.reads += 1;
          return store.readRecordedOfKeys(keys, selection, page);
        },
        definitionStreams: (definitionType) =>
          counted.failingDiscovery
            ? Promise.reject(new Error('The store was told to fail'))
            : store.definitionStreams(definitionType),
      },
    },
    reads: () => counted.reads,
    failingDiscovery: (fails) => {
      counted.failingDiscovery = fails;
    },
  };
}

type StartOf = Partial<ViewsProjecting> & {
  readonly sweepEveryMs?: number;
  /** The clock the projector runs on: the harness's own, `clock`, unless the test gives one. */
  readonly clock?: SteppedClock;
  /** What the projector sleeps on between wakes, wrapping its clock, for a test that watches its sleeps. */
  readonly pace?: HostClock;
  readonly through?: (database: HostDatabase) => HostDatabase;
};

function asItIs(database: HostDatabase): HostDatabase {
  return database;
}

interface WhenFolded {
  <A, B extends A>(read: () => A | Promise<A>, holds: (value: A) => value is B): Promise<B>;
  <A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A>;
}

export interface HarnessProjectors {
  /** The clock the projectors of the harness run on unless a test gives one, starting at `projectedFrom`. */
  readonly clock: SteppedClock;
  readonly start: (more?: StartOf) => Projector;
  readonly reads: () => number;
  readonly failingDiscovery: (fails: boolean) => void;
  readonly stopProjectors: () => Promise<unknown>;
  /**
   * Answers once what `read` reads holds, read each time the projector started last is at rest, its clock stepped one
   * of its sweeps at a time while it does not hold, a few sweeps at most.
   */
  readonly whenFolded: WhenFolded;
  /** Answers once the projector started last has been woken by one more of its sweeps, from rest, and rests again. */
  readonly sweptOnce: () => Promise<void>;
}

export interface ProjectorsOf {
  readonly database: HostDatabase;
  readonly reports: HostReports;
  readonly settingsOf: ViewSettingsOf;
}

/** The moment the clock of a harness starts at: after every moment its records are saved at. */
const projectedFrom = Date.parse('2026-11-01T09:00:00.000Z');

const sweepByDefaultMs = 50;

export function harnessProjectors({ database, reports, settingsOf }: ProjectorsOf): HarnessProjectors {
  const counting = countingDatabase(database);
  const projectors: Projector[] = [];
  const clock = steppedClock(projectedFrom);
  const last = { clock, everyMs: sweepByDefaultMs };
  function whenFolded<A, B extends A>(read: () => A | Promise<A>, holds: (value: A) => value is B): Promise<B>;
  function whenFolded<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A>;
  function whenFolded<A>(read: () => A | Promise<A>, holds: (value: A) => boolean): Promise<A> {
    return steppedBy(last.clock, last.everyMs).until(read, holds, fewSweeps);
  }
  return {
    clock,
    reads: counting.reads,
    failingDiscovery: counting.failingDiscovery,
    start: ({
      sweepEveryMs = sweepByDefaultMs,
      clock: given = clock,
      pace = given,
      through = asItIs,
      ...more
    } = {}) => {
      const projector = startProjector({
        database: through(counting.database),
        settings: settingsOf(more),
        reports,
        clock: given,
        pace,
        sweepEveryMs,
        context: given.watching(),
      });
      last.clock = given;
      last.everyMs = sweepEveryMs;
      projectors.push(projector);
      return projector;
    },
    stopProjectors: () => Promise.all(projectors.map((projector) => projector.stop())),
    whenFolded,
    sweptOnce: async () => {
      await last.clock.atRest();
      last.clock.step(last.everyMs);
      await last.clock.atRest();
    },
  };
}
