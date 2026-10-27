import type { AppRuntime, RegisterRoutes } from '@on.auto/api';
import { computationBounds } from '@on.auto/computation';
import { RunAdmission } from '@on.auto/definitions';
import {
  openSelfHostedMeter,
  selfHostedRuns,
  type InstallationStorage,
  type LicenseClientOptions,
} from '@on.auto/meter';
import { recallBounds } from '@on.auto/recall';
import { Context, Effect } from 'effect';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import type { ServerServices } from '../server-options/composed-options.ts';
import { licenseControls } from './control-routes.ts';
import { meterMaintenance } from './maintenance.ts';

export interface RuntimeMeterOptions extends Pick<LicenseClientOptions, 'trust' | 'clock' | 'fetch'> {
  readonly operatorKeyIds: readonly string[];
}

function closingMeter(routes: readonly RegisterRoutes[], stop: () => Promise<void>) {
  return (served: Readonly<{ routes: readonly RegisterRoutes[]; stopWork: () => Promise<void> }>) => ({
    routes: [...served.routes, ...routes],
    stopWork: async () => {
      await stop();
      await served.stopWork();
    },
  });
}

async function openedMeter(storage: InstallationStorage, options: RuntimeMeterOptions) {
  try {
    return await openSelfHostedMeter({ ...options, ...storage });
  } catch (error) {
    await storage.secrets.close();
    throw error;
  }
}

export async function runtimeMeter(
  runtime: AppRuntime<ServerServices>,
  storage: InstallationStorage,
  options: RuntimeMeterOptions | undefined,
) {
  if (options === undefined) return { runtime, dueWork: [], closing: closingMeter([], () => Promise.resolve()) };
  const meter = await openedMeter(storage, options);
  const runs = selfHostedRuns({
    connection: storage.connection,
    meter,
    limits: {
      computation: computationBounds,
      recall: { ...recallBounds, memoryBytes: recallBounds.answerMemoryBytes },
    },
  });
  const metered: AppRuntime<ServerServices> = {
    ...runtime,
    context: Context.add(runtime.context, RunAdmission, runs.admission),
    run: (effect, signal) => runtime.run(Effect.provideService(effect, RunAdmission, runs.admission), signal),
  };
  const reader = runtimeLedger(metered);
  const controls = licenseControls(meter, runs, reader, options.operatorKeyIds);
  return {
    runtime: metered,
    dueWork: [meterMaintenance(meter, runs, reader)],
    closing: closingMeter([controls.routes], controls.stop),
  };
}
