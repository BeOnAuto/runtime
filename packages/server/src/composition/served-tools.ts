import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import type { ToolAccessOptions } from '@on.auto/tool-servers';

import type { Served } from '../lifecycle/lifecycle.ts';
import type { Settings } from '../settings/settings.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { reasoningServedBy, type ModelAccessOf, type ServedReasoning } from './served-reasoning.ts';
import { toolAccessOf, type ServedConnections, type ToolAccessWiring } from './served-tool-access.ts';
import { toolOperationsOf, type ProvidersOffered, type ServedToolOperations } from './served-tool-operations.ts';

export interface ToolWiring extends ToolAccessWiring {
  readonly modelAccessOf: ModelAccessOf;
  readonly telemetry?: {
    readonly models: Parameters<ModelAccessOf>[2];
    readonly traceMeta: ToolAccessOptions['traceMeta'];
  };
}

export type ToolUsersWiring = ToolWiring & ServedConnections & ProvidersOffered;

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly interaction: ServedInteraction;
  readonly toolOperations: ServedToolOperations;
  readonly withToolsClosed: (served: Served) => Served;
}

export async function toolUsersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  { modelAccessOf, ...wiring }: ToolUsersWiring,
): Promise<ServedToolUsers> {
  const tools = await toolAccessOf(runtime, settings, wiring);
  const models = wiring.telemetry?.models;
  const access: ModelAccessOf = (modelSettings, proxy) => modelAccessOf(modelSettings, proxy, models);
  return {
    reasoning: await reasoningServedBy(runtime, settings, access, tools),
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
