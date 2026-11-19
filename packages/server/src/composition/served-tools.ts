import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';

import type { CapabilityRegistry } from '../capability-registry/capability-registry.ts';
import type { Settings } from '../settings/settings.ts';
import { subscriptionsOfTheServer, type SubscriptionsServing } from '../subscriptions/served-subscriptions.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { lookupServedBy, type ServedLookup } from './served-lookup.ts';
import { reasoningServedBy, type ServedReasoning } from './served-reasoning.ts';
import {
  requestWaysOf,
  toolAccessOf,
  type MadeToolAccess,
  type ServedConnections,
  type ToolAccessWiring,
} from './served-tool-access.ts';
import { toolOperationsOf, type ProvidersOffered, type ServedToolOperations } from './served-tool-operations.ts';

export interface ToolUsersWiring extends ProvidersOffered {
  readonly registry: CapabilityRegistry;
  readonly connections: Pick<ServedConnections['connections'], 'takesConnections'>;
  readonly toolTiming?: NonNullable<ToolAccessWiring['toolTiming']>;
  readonly secrets: SubscriptionsServing['secrets'];
  readonly results?: boolean | undefined;
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly lookup: ServedLookup;
  readonly interaction: ServedInteraction;
  readonly toolOperations: ServedToolOperations;
  readonly listServers: MadeToolAccess['listServers'];
  readonly named: MadeToolAccess['named'];
  readonly subscriptions: ReturnType<typeof subscriptionsOfTheServer>;
}

export async function toolUsersServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  { registry, connections, offering, goals, results, messages, toolTiming, secrets }: ToolUsersWiring,
): Promise<ServedToolUsers> {
  const tools = toolAccessOf(registry.tools, settings, connections, toolTiming);
  return {
    reasoning: await reasoningServedBy(runtime, settings, registry.models, {
      tools,
      telemetry: registry.modelTelemetry,
    }),
    lookup: lookupServedBy(runtime, tools),
    interaction: interactionServedBy(runtime, settings, tools, results === true),
    toolOperations: toolOperationsOf(tools, { offering, goals, messages }),
    listServers: tools.listServers,
    named: tools.named,
    subscriptions: subscriptionsOfTheServer(runtime, settings, {
      tools: { ...tools, ...requestWaysOf(registry.tools) },
      secrets,
    }),
  };
}
