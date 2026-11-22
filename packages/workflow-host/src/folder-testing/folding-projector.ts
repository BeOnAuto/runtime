import type { AppendSignal } from '@on.auto/ledger';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HostContext } from '../loop/forked-fibers.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import type { SomeFolder } from '../projector/folder.ts';
import { startProjector, type Projector } from '../projector/projector.ts';

export type { Projector } from '../projector/projector.ts';

export interface ProjectingOptions {
  readonly sweepEveryMs?: number;
  readonly pagesPerWake?: number;
  readonly playbooksAtOnce?: number;
  readonly through?: (database: HostDatabase) => HostDatabase;
  /** The clock the projector sleeps on, the system's unless a test gives one, and the context it forks in. */
  readonly clock?: HostClock;
  readonly context?: HostContext;
}

function asItIs(database: HostDatabase): HostDatabase {
  return database;
}

interface ProjectorFor {
  readonly database: HostDatabase;
  readonly folders: readonly SomeFolder[];
  readonly appends: AppendSignal;
  readonly reports: HostReports;
}

export function projectorOf(
  { database, folders, appends, reports }: ProjectorFor,
  {
    sweepEveryMs = 50,
    pagesPerWake = 10,
    playbooksAtOnce = 4,
    through = asItIs,
    clock = systemClock,
    context,
  }: ProjectingOptions = {},
): Projector {
  return startProjector({
    database: through(database),
    settings: { folders, playbooksAtOnce, pagesPerWake, appends },
    reports,
    clock,
    sweepEveryMs,
    context,
  });
}
