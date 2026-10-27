import type { AppRuntime } from '@on.auto/api';
import { liveAttemptsClosed, liveAttemptsLayer } from '@on.auto/definitions';
import type { LedgerServices } from '@on.auto/ledger';
import { IncidentReporter, type DispatcherServices } from '@on.auto/operations';
import { ledgerPlaybookRegistry } from '@on.auto/playbooks';
import { Layer } from 'effect';

import { meterLayerOver, unlicensed, type MeterComposing } from '../licensing/meter-layer.ts';
import { logIncident } from '../logging/logging.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import type { Served } from '../server-options/server-options.ts';

const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function applicationLayer(
  ledger: Layer.Layer<LedgerServices>,
  meter: MeterComposing = unlicensed,
): Layer.Layer<ServerServices> {
  return Layer.mergeAll(
    ledger,
    ledgerPlaybookRegistry.pipe(Layer.provide(ledger)),
    meterLayerOver(ledger, meter),
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
