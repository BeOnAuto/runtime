import type { RecordedPoint } from '@on.auto/ledger';
import type { Conflict } from '@on.auto/operations';
import type { RunInput, Submission } from '@on.auto/workflow-engine';
import type { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HostContext } from '../loop/forked-fibers.ts';
import type { HostClock } from '../loop/host-clock.ts';

export interface FollowerHost {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly clock: HostClock;
  readonly sweepEveryMs: number;
  readonly reports: HostReports;
  readonly context?: HostContext;
  readonly placeAtOpen: RecordedPoint;
}
