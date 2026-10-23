import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { ConnectionSource, Timing } from '@on.auto/tool-servers';

import type { CapabilityRegistry } from '../capability-registry/capability-registry.ts';
import type { Settings } from '../settings/settings.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ServedReasoning } from './served-reasoning.ts';
import { toolAccessOf } from './served-tool-access.ts';
import { toolOperationsOf, type ProvidersOffered, type ServedToolOperations } from './served-tool-operations.ts';

export interface ToolUsersWiring extends ProvidersOffered {
  readonly registry: CapabilityRegistry;
  readonly connections: Pick<ConnectionSource, 'takesConnections'>;
  readonly toolTiming?: Timing;
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly toolOperations: ServedToolOperations;
}

export async function toolUsersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  { registry, connections, offering, toolTiming }: ToolUsersWiring,
): Promise<ServedToolUsers> {
  const tools = toolAccessOf(registry.tools, settings, connections, toolTiming);
  return {
    reasoning: await reasoningServedBy(runtime, settings, registry.models, tools),
    interaction: interactionServedBy(runtime, settings, tools),
    toolOperations: toolOperationsOf(tools, { offering }),
  };
}
