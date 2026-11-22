import { liveAttemptsLayer, type LiveAttempts } from '@on.auto/definitions';
import { valuesKeptAsAssets, type GenerationBounds } from '@on.auto/generation';
import type { LedgerServices } from '@on.auto/ledger';
import { AssetKeeper, IncidentReporter } from '@on.auto/operations';
import {
  PayloadOffloading,
  payloadGateOf,
  PayloadSizeThreshold,
  PayloadsShared,
  sharedPayloadsWithin,
} from '@on.auto/operations/payloads';
import { HeldValueSizeThreshold, hostPayloadCacheBytes } from '@on.auto/workflow-host';
import { Context, Effect, Layer } from 'effect';

import { leasedAttemptsLayer } from '../attempt-leases/leased-attempts.ts';
import { logIncident } from '../logging/logging.ts';
import type { PayloadSettings } from '../settings/content-settings.ts';

export const loggingIncidentReporter = Layer.succeed(IncidentReporter, IncidentReporter.of({ report: logIncident }));

/** The payloads the process shares, its gate counting its wait on the clock the server is given, where it is given one. */
export function payloadsSharedInTheProcess(now?: () => number) {
  const shared = sharedPayloadsWithin(hostPayloadCacheBytes);
  return Layer.succeed(
    PayloadsShared,
    now === undefined ? shared : { ...shared, gate: payloadGateOf(Effect.sync(now)) },
  );
}

export function payloadOffloadingOf({ offloading, sizeThresholdBytes }: PayloadSettings): Layer.Layer<never> {
  return Layer.succeedContext(
    Context.make(PayloadOffloading, offloading).pipe(
      Context.add(PayloadSizeThreshold, sizeThresholdBytes),
      Context.add(HeldValueSizeThreshold, sizeThresholdBytes),
    ),
  );
}

export function valuesKeptWithin(bounds: GenerationBounds): Layer.Layer<never> {
  return Layer.succeed(AssetKeeper, valuesKeptAsAssets(bounds));
}

export function liveAttemptsOver(
  ledger: Layer.Layer<LedgerServices>,
  holding: Parameters<typeof leasedAttemptsLayer>[0] | undefined,
): Layer.Layer<LiveAttempts> {
  return holding === undefined
    ? liveAttemptsLayer.pipe(Layer.provide(loggingIncidentReporter))
    : leasedAttemptsLayer(holding).pipe(Layer.provide(Layer.merge(loggingIncidentReporter, ledger)));
}
