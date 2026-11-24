import { Effect } from 'effect';

import { actsAsAManagedServiceAccount } from '../registry/exchange-credentials.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { serviceAccountUncreated } from '../registry/service-account-decisions.ts';
import { exchangesItsToken } from '../serving/exchanged-credentials.ts';
import { exchangeCheckedFor } from './checked-exchanges.ts';
import { reachesNothingYet, type ExchangeChecking, type Reached } from './exchange-checks.ts';

const nothingChecked: Reached = { reached: undefined };

export const checkedBeforeApproval = Effect.fnUntraced(function* (kept: KeptConnection, services: ExchangeChecking) {
  if (!exchangesItsToken(kept)) {
    return nothingChecked;
  }
  const { connection } = kept;
  const managed = actsAsAManagedServiceAccount(connection.credential);
  if (managed && kept.serviceAccount === undefined) {
    return yield* Effect.fail(serviceAccountUncreated(connection));
  }
  const checked = yield* exchangeCheckedFor(kept, services);
  return managed && checked.reached?.length === 0 ? yield* Effect.fail(reachesNothingYet(connection)) : checked;
});
