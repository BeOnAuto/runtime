import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { ModelAccess, ModelTelemetry } from '@on.auto/reasoning';
import type { ToolAccess, ToolServerDocumentRefused } from '@on.auto/tool-servers';
import { Effect, type Layer, type Scope } from 'effect';

import { ComposedModels, modelsComposedBy, type ModelAccessOf } from '../composition/served-reasoning.ts';
import {
  ComposedTools,
  toolsComposedBy,
  type ServedConnections,
  type ToolAccessWiring,
} from '../composition/served-tool-access.ts';
import type { Settings } from '../settings/settings.ts';
import { composedOnFirstUse, scopeOfTheRuntime } from './first-use.ts';

export interface CapabilityRegistry {
  readonly models: Effect.Effect<ModelAccess>;
  readonly tools: Effect.Effect<ToolAccess, ToolServerDocumentRefused>;
}

export interface HeldRegistry {
  readonly closedFirstOf: <R>(services: Layer.Layer<R>) => Layer.Layer<R>;
  readonly openedIn: (
    runtime: AppRuntime<DispatcherServices>,
    settings: Settings,
    wiring: RegistryWiring,
  ) => Promise<CapabilityRegistry>;
}

interface RegistryWiring extends ToolAccessWiring, ServedConnections {
  readonly modelAccessOf: ModelAccessOf;
  readonly telemetry: NonNullable<ToolAccessWiring['telemetry']> & { readonly models: ModelTelemetry | undefined };
}

function capabilityRegistryOf(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  wiring: RegistryWiring,
): Effect.Effect<CapabilityRegistry, never, Scope.Scope> {
  return Effect.all({
    models: composedOnFirstUse(
      ComposedModels,
      modelsComposedBy(settings, wiring.modelAccessOf, wiring.telemetry.models),
    ),
    tools: composedOnFirstUse(ComposedTools, toolsComposedBy(runtime, settings, wiring)),
  });
}

export function capabilityRegistryHeld(): HeldRegistry {
  const { closedFirstOf, openedIn } = scopeOfTheRuntime();
  return {
    closedFirstOf,
    openedIn: (runtime, settings, wiring) => openedIn(runtime, capabilityRegistryOf(runtime, settings, wiring)),
  };
}
