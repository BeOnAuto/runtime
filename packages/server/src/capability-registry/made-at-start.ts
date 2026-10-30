import type { ShippedFiles } from '@on.auto/operations';
import { recallBounds } from '@on.auto/recall';

import { computationServedBy, type ProgramPoolOf, type ServedComputation } from '../composition/served-computation.ts';
import type { InstalledPackages } from '../extensions/extension-loading.ts';
import { extensionsServedBy, type ServedExtensions } from '../extensions/served-extensions.ts';
import type { Settings } from '../settings/settings.ts';
import { capabilityRegistryHeld, type HeldRegistry } from './capability-registry.ts';
import { providedOnceServed, type ProvidedOnceServed } from './served-ports.ts';

export interface MadeAtStart {
  readonly registry: HeldRegistry;
  readonly extensions: ServedExtensions;
  readonly computation: ServedComputation;
  readonly prediction: ProvidedOnceServed;
}

export interface StartWiring {
  readonly programPoolOf: ProgramPoolOf;
  readonly shippedFiles: ShippedFiles;
  readonly installed?: InstalledPackages | undefined;
}

export async function madeAtStart(
  settings: Settings,
  { programPoolOf, shippedFiles, installed }: StartWiring,
): Promise<MadeAtStart> {
  const extensions = await extensionsServedBy(settings, installed);
  const computation = await computationServedBy(settings.computation, programPoolOf, shippedFiles);
  const prediction = await computation.closedIfRefused(() =>
    providedOnceServed(extensions.makePrediction, {
      pool: computation.pool,
      mostFunctions: settings.prediction.mostFunctions,
      triesBeforeStall: recallBounds.overtimesBeforeStall,
    }),
  );
  return { registry: capabilityRegistryHeld(), extensions, computation, prediction };
}
