import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { ModelAccess } from '@on.auto/reasoning';
import { Effect, Exit, Scope, type Layer } from 'effect';

import { ComposedModels } from '../composition/served-reasoning.ts';
import type { ServedClosing } from '../server-options/server-options.ts';
import { inRuntime } from '../workflows/in-runtime.ts';
import { composedOnFirstUse } from './first-use.ts';

export interface CapabilityRegistry {
  readonly models: Effect.Effect<ModelAccess>;
}

export interface CapabilityLayers {
  readonly models: Layer.Layer<ComposedModels>;
}

export interface OpenedRegistry {
  readonly registry: CapabilityRegistry;
  readonly withRegistryClosed: ServedClosing;
}

function capabilityRegistryOf(layers: CapabilityLayers): Effect.Effect<CapabilityRegistry, never, Scope.Scope> {
  return Effect.all({ models: composedOnFirstUse(ComposedModels, layers.models) });
}

export async function capabilityRegistryOpenedIn(
  runtime: AppRuntime<DispatcherServices>,
  layers: CapabilityLayers,
): Promise<OpenedRegistry> {
  const scope = Scope.makeUnsafe();
  const registry = await Effect.runPromise(inRuntime(runtime, Scope.provide(capabilityRegistryOf(layers), scope)));
  return {
    registry,
    withRegistryClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await Effect.runPromise(Scope.close(scope, Exit.void));
      },
    }),
  };
}
