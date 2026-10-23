import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';

import type { CapabilityRegistry } from '../capability-registry/capability-registry.ts';
import type { Served } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ServedReasoning } from './served-reasoning.ts';
import { toolAccessOf, type ServedConnections, type ToolAccessWiring } from './served-tool-access.ts';
import { toolOperationsOf, type ProvidersOffered, type ServedToolOperations } from './served-tool-operations.ts';

export interface ToolUsersWiring extends ToolAccessWiring, ServedConnections, ProvidersOffered {
  readonly registry: CapabilityRegistry;
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly toolOperations: ServedToolOperations;
  readonly withToolsClosed: (served: Served) => Served;
}

export async function toolUsersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  { registry, ...wiring }: ToolUsersWiring,
): Promise<ServedToolUsers> {
  const tools = await toolAccessOf(runtime, settings, wiring);
  return {
    reasoning: await reasoningServedBy(runtime, settings, registry.models, tools),
    interaction: interactionServedBy(runtime, settings, tools),
    toolOperations: toolOperationsOf(tools, wiring),
    withToolsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await tools.close();
      },
    }),
  };
}
