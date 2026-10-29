import type { Conflict, Unavailable } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { SignedReport } from '../accounts/account-service.ts';
import type { Licensing } from '../licensing/licensing.ts';
import type { Signed } from '../licensing/signed-answers.ts';
import { allocationRefreshed } from './allocation-refresh.ts';
import { allocationReportOf, reportedHourly } from './allocation-reports.ts';
import { allocated, type AllocationStanding } from './allocation.ts';

export interface AllocationPorts {
  readonly reported: Effect.Effect<void, Unavailable>;
  readonly allocationRefreshed: Effect.Effect<void>;
  readonly allocate: (allocation: Signed) => Effect.Effect<AllocationStanding, Conflict | Unavailable>;
  readonly allocationReport: (of: string | undefined) => Effect.Effect<SignedReport, Conflict | Unavailable>;
}

export function allocationPortsOf(licensing: Licensing): AllocationPorts {
  return {
    reported: reportedHourly(licensing),
    allocationRefreshed: allocationRefreshed(licensing),
    allocate: (allocation) => allocated(licensing, allocation),
    allocationReport: (of) => allocationReportOf(licensing, of),
  };
}
