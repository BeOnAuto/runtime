import type { AppRuntime } from '@on.auto/api';
import { liveAttemptsClosed } from '@on.auto/definitions';
import type { LedgerServices } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import { ledgerPlaybookRegistry } from '@on.auto/playbooks';
import { Layer } from 'effect';

import { meterLayerOver, unlicensed, type MeterComposing } from '../licensing/meter-layer.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import type { Served } from '../server-options/server-options.ts';
import {
  liveAttemptsOver,
  loggingIncidentReporter,
  payloadOffloadingOf,
  payloadsSharedInTheProcess,
  valuesKeptWithin,
} from './process-layers.ts';

interface ProcessSettings {
  readonly payloads: Parameters<typeof payloadOffloadingOf>[0];
  readonly generation: Parameters<typeof valuesKeptWithin>[0];
}

function settledLayersOf(settings: ProcessSettings | undefined): Layer.Layer<never> {
  return settings === undefined
    ? Layer.empty
    : Layer.merge(payloadOffloadingOf(settings.payloads), valuesKeptWithin(settings.generation));
}

export function dispatcherServicesOver(
  ledger: Layer.Layer<LedgerServices>,
): Layer.Layer<DispatcherServices | LedgerServices> {
  return Layer.mergeAll(ledger, ledgerPlaybookRegistry.pipe(Layer.provide(ledger)), loggingIncidentReporter);
}

export function applicationLayer(
  ledger: Layer.Layer<LedgerServices>,
  meter: MeterComposing = unlicensed,
  settings?: ProcessSettings,
  holding?: Parameters<typeof liveAttemptsOver>[1],
): Layer.Layer<ServerServices> {
  return Layer.mergeAll(
    dispatcherServicesOver(ledger),
    meterLayerOver(ledger, meter),
    liveAttemptsOver(ledger, holding),
    payloadsSharedInTheProcess(),
    settledLayersOf(settings),
  );
}

export function withLiveAttemptsClosedFirst(runtime: AppRuntime<DispatcherServices>, served: Served): Served {
  return {
    ...served,
    stopWork: async () => {
      await runtime.run(liveAttemptsClosed);
      await served.stopWork();
    },
  };
}
