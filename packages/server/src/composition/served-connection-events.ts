import type { AppRuntime } from '@on.auto/api';
import { connectionEventsOver } from '@on.auto/connections';
import { listenedConnectionsOf } from '@on.auto/definitions/listened-connections';
import type { DispatcherServices } from '@on.auto/operations';
import { Effect } from 'effect';

import { eventsReceivedAt } from '../connections/connection-policies.ts';
import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export function connectionEventsOf(
  runtime: AppRuntime<DispatcherServices>,
  { providers, receiving }: Pick<Settings, 'providers' | 'receiving'>,
) {
  const ledger = runtimeLedger(runtime);
  return connectionEventsOver(
    {
      registry: ledger,
      providers: Effect.succeed(providers),
      subscriptions: ledger,
      received: eventsReceivedAt(receiving),
    },
    (playbook) => listenedConnectionsOf(ledger, playbook),
  );
}
