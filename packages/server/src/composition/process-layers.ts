import { liveAttemptsLayer, type LiveAttempts } from '@on.auto/definitions';
import type { LedgerServices } from '@on.auto/ledger';
import { IncidentReporter } from '@on.auto/operations';
import {
  PayloadOffloading,
  PayloadSizeThreshold,
  PayloadsShared,
  sharedPayloadsWithin,
} from '@on.auto/operations/payloads';
import { HeldValueSizeThreshold, hostPayloadCacheBytes } from '@on.auto/workflow-host';
import { Context, Layer } from 'effect';

import type { AttemptHolding } from '../attempt-leases/attempt-holding.ts';
import { leasedAttemptsLayer } from '../attempt-leases/leased-attempts.ts';
import { logIncident } from '../logging/logging.ts';
import type { PayloadSettings } from '../settings/content-settings.ts';

export const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

export function payloadsSharedInTheProcess() {
  return Layer.succeed(PayloadsShared, sharedPayloadsWithin(hostPayloadCacheBytes));
}

export function payloadOffloadingOf({ offloading, sizeThresholdBytes }: PayloadSettings): Layer.Layer<never> {
  return Layer.succeedContext(
    Context.make(PayloadOffloading, offloading).pipe(
      Context.add(PayloadSizeThreshold, sizeThresholdBytes),
      Context.add(HeldValueSizeThreshold, sizeThresholdBytes),
    ),
  );
}

export function liveAttemptsOver(
  ledger: Layer.Layer<LedgerServices>,
  holding: AttemptHolding | undefined,
): Layer.Layer<LiveAttempts> {
  return holding === undefined
    ? liveAttemptsLayer.pipe(Layer.provide(loggingIncidentReporter))
    : leasedAttemptsLayer(holding).pipe(Layer.provide(Layer.merge(loggingIncidentReporter, ledger)));
}
