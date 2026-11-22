import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { modelChoiceOf, type ModelAccess, type ModelTelemetry } from '@on.auto/reasoning';
import type { ThroughWays, ToolServerDocumentRefused } from '@on.auto/tool-servers';
import { Effect, type Layer, type Scope } from 'effect';

import { processesServedBy, type ServedProcesses } from '../composition/served-processes.ts';
import { ComposedModels, modelsComposedBy, type ModelAccessOf } from '../composition/served-reasoning.ts';
import {
  ComposedTools,
  throughWaysOf,
  toolsComposedBy,
  type MadeToolAccess,
  type ServedConnections,
  type ToolAccessWiring,
} from '../composition/served-tool-access.ts';
import type { Settings } from '../settings/settings.ts';
import { composedOnFirstUse, scopeOfTheRuntime } from './first-use.ts';

export interface CapabilityRegistry extends ThroughWays {
  readonly models: Effect.Effect<ModelAccess>;
  readonly modelChoice: ReturnType<typeof modelChoiceOf>;
  readonly modelTelemetry: ModelTelemetry | undefined;
  readonly tools: Effect.Effect<MadeToolAccess, ToolServerDocumentRefused>;
  readonly processes: ServedProcesses;
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
  readonly documents: ServedProcesses['documents'] | undefined;
}

function capabilityRegistryOf(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  wiring: RegistryWiring,
): Effect.Effect<CapabilityRegistry, never, Scope.Scope> {
  const processes = processesServedBy(settings, wiring.documents);
  return Effect.all({
    models: composedOnFirstUse(
      ComposedModels,
      modelsComposedBy(settings, wiring.modelAccessOf, wiring.telemetry.models),
    ),
    modelTelemetry: Effect.succeed(wiring.telemetry.models),
    tools: composedOnFirstUse(
      ComposedTools,
      toolsComposedBy(runtime, settings, { ...wiring, documents: processes.documents }),
    ),
  }).pipe(
    Effect.map(({ models, modelTelemetry, tools }) => ({
      models,
      modelChoice: modelChoiceOf(models),
      modelTelemetry,
      tools,
      processes,
      readOnceThrough: throughWaysOf(tools).readOnceThrough,
    })),
  );
}

export function capabilityRegistryHeld(): HeldRegistry {
  const { closedFirstOf, openedIn } = scopeOfTheRuntime();
  return {
    closedFirstOf,
    openedIn: (runtime, settings, wiring) => openedIn(runtime, capabilityRegistryOf(runtime, settings, wiring)),
  };
}
