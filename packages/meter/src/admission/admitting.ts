import type { Meter, MeteredRun } from '@on.auto/definitions';
import type { Conflict, Ledger, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { hasStarted, meterUnavailable } from './metering.ts';

export type Admitter = (run: MeteredRun) => Effect.Effect<void, Conflict | Unavailable>;

export interface MeteredLedger {
  readonly ledger: Ledger['Service'];
}

export function meterAdmitting(ledgered: MeteredLedger, admitter: Admitter): Meter {
  return {
    admit: (run) =>
      Effect.flatMap(hasStarted(ledgered, run), (started) => (started ? Effect.void : admitter(run))).pipe(
        Effect.catchDefect(() => Effect.fail(meterUnavailable)),
      ),
  };
}
