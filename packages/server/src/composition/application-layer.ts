import type { AppRuntime } from '@on.auto/api';
import { liveAttemptsClosed, liveAttemptsLayer } from '@on.auto/definitions';
import type { AppendSignal, LedgerServices } from '@on.auto/ledger';
import { IncidentReporter, type DispatcherServices } from '@on.auto/operations';
import { ledgerPlaybookRegistry } from '@on.auto/playbooks';
import { Layer } from 'effect';

import { withARefusedLayoutExplained, type LedgerDatabase } from '../database/ledger-database.ts';
import { logIncident } from '../logging/logging.ts';
import type { Served } from '../server-options/server-options.ts';
import { ledgerLayerFor } from './ledger-store.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayerOn(
  settings: Parameters<typeof ledgerLayerFor>[0] & Parameters<typeof withARefusedLayoutExplained>[1],
  database: LedgerDatabase,
  appends: AppendSignal,
) {
  return applicationLayer(withARefusedLayoutExplained(ledgerLayerFor(settings, database, appends), settings));
}

export function applicationLayer(
  ledger: Layer.Layer<LedgerServices>,
): Layer.Layer<DispatcherServices | LedgerServices> {
  return Layer.mergeAll(
    ledger,
    ledgerPlaybookRegistry.pipe(Layer.provide(ledger)),
    loggingIncidentReporter,
    liveAttemptsLayer.pipe(Layer.provide(loggingIncidentReporter)),
  );
}

export function withLiveAttemptsClosedFirst(
  runtime: AppRuntime<DispatcherServices>,
  { routes, stopWork }: Served,
): Served {
  return {
    routes,
    stopWork: async () => {
      await runtime.run(liveAttemptsClosed);
      await stopWork();
    },
  };
}
