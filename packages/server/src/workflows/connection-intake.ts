import type { AppRuntime } from '@on.auto/api';
import { servedConnectionOf } from '@on.auto/connections';
import { connectionEventRecorder } from '@on.auto/definitions/connection-events';
import { savedTriggersOf } from '@on.auto/definitions/connection-triggers';
import { PlaybookRegistry, type DispatcherServices } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { connectionEventIntakeOf, type TakeIn, type WorkflowStore } from '@on.auto/workflow-host';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { inRuntime } from './in-runtime.ts';

export interface IntakeServing {
  readonly store: WorkflowStore;
  readonly filters: FilterSandbox;
  readonly providers: ProviderList;
  readonly now: () => number;
}

function runtimeRegistry(runtime: AppRuntime<DispatcherServices>): PlaybookRegistry['Service'] {
  return PlaybookRegistry.of({
    status: (playbook) =>
      inRuntime(
        runtime,
        PlaybookRegistry.use((registry) => registry.status(playbook)),
      ),
  });
}

export function connectionIntakeServedBy(
  runtime: AppRuntime<DispatcherServices>,
  { store, filters, providers, now }: IntakeServing,
): TakeIn {
  const ledger = runtimeLedger(runtime);
  const servedOf = servedConnectionOf({ registry: ledger, providers });
  return connectionEventIntakeOf({
    database: store.database,
    filters,
    now,
    servedConnection: (playbook, connection) => servedOf({ ...playbook, connection }),
    registry: runtimeRegistry(runtime),
    savedTriggers: savedTriggersOf(ledger),
    record: connectionEventRecorder(ledger),
  });
}
