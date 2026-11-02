import { isAgentAction, type Meter, type MeteredAction } from '@on.auto/definitions';
import type { Conflict, Ledger, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { hasStarted, meterUnavailable } from './metering.ts';

export type Admitter = (action: MeteredAction) => Effect.Effect<void, Conflict | Unavailable>;

export interface MeteredLedger {
  readonly ledger: Ledger['Service'];
}

function startedAlready(ledgered: MeteredLedger, action: MeteredAction): Effect.Effect<boolean> {
  return isAgentAction(action) ? Effect.succeed(false) : hasStarted(ledgered, action);
}

export function meterAdmitting(ledgered: MeteredLedger, admitter: Admitter): Meter {
  return {
    admit: (action) =>
      Effect.flatMap(startedAlready(ledgered, action), (started) => (started ? Effect.void : admitter(action))).pipe(
        Effect.catchDefect(() => Effect.fail(meterUnavailable)),
      ),
  };
}
