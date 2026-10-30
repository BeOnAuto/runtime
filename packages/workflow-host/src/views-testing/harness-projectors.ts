import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { startProjector, type Projector } from '../projector/projector.ts';
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
        readRecorded: (playbookKey, selection, page) => {
          counted.reads += 1;
          return store.readRecorded(playbookKey, selection, page);
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
  readonly clock?: HostClock;
  readonly through?: (database: HostDatabase) => HostDatabase;
};

function asItIs(database: HostDatabase): HostDatabase {
  return database;
}

export interface HarnessProjectors {
  readonly start: (more?: StartOf) => Projector;
  readonly reads: () => number;
  readonly failingDiscovery: (fails: boolean) => void;
  readonly stopProjectors: () => Promise<unknown>;
}

export interface ProjectorsOf {
  readonly database: HostDatabase;
  readonly reports: HostReports;
  readonly settingsOf: ViewSettingsOf;
}

export function harnessProjectors({ database, reports, settingsOf }: ProjectorsOf): HarnessProjectors {
  const counting = countingDatabase(database);
  const projectors: Projector[] = [];
  return {
    reads: counting.reads,
    failingDiscovery: counting.failingDiscovery,
    start: ({ sweepEveryMs = 50, clock = systemClock, through = asItIs, ...more } = {}) => {
      const projector = startProjector({
        database: through(counting.database),
        settings: settingsOf(more),
        reports,
        clock,
        sweepEveryMs,
      });
      projectors.push(projector);
      return projector;
    },
    stopProjectors: () => Promise.all(projectors.map((projector) => projector.stop())),
  };
}
