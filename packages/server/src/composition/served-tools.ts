import type { CapabilityRegistry } from '../capability-registry/capability-registry.ts';
import type { Settings } from '../settings/settings.ts';
import {
  subscriptionsOfTheServer,
  type ServedSubscriptions,
  type SubscriptionsServing,
} from '../subscriptions/served-subscriptions.ts';
import { connectionIntakeServedBy, type IntakeServing } from '../workflows/connection-intake.ts';
import { connectionEventsOf } from './served-connection-events.ts';
import { interactionServedBy, type ServedInteraction } from './served-interaction.ts';
import { lookupServedBy, type ServedLookup } from './served-lookup.ts';
import { reasoningServedBy, type ServedReasoning } from './served-reasoning.ts';
import {
  connectionAccessOf,
  requestWaysOf,
  toolAccessOf,
  type MadeToolAccess,
  type ServedConnections,
  type ToolAccessWiring,
} from './served-tool-access.ts';
import { toolOperationsOf, type ProvidersOffered, type ServedToolOperations } from './served-tool-operations.ts';

type ServingRuntime = Parameters<typeof interactionServedBy>[0];

export interface ToolUsersWiring extends ProvidersOffered {
  readonly registry: CapabilityRegistry;
  readonly connections: Pick<ServedConnections['connections'], 'takesConnections'>;
  readonly toolTiming?: NonNullable<ToolAccessWiring['toolTiming']>;
  readonly secrets: SubscriptionsServing['secrets'];
  readonly results?: boolean | undefined;
  readonly now?: () => number;
}

export interface ServedToolUsers {
  readonly reasoning: ServedReasoning;
  readonly lookup: ServedLookup;
  readonly interaction: ServedInteraction;
  readonly toolOperations: ServedToolOperations;
  readonly listServers: MadeToolAccess['listServers'];
  readonly connections: ReturnType<typeof connectionAccessOf>;
  readonly connectionEvents: ReturnType<typeof connectionEventsOf>;
  readonly named: MadeToolAccess['named'];
  readonly subscriptionsOver: (
    store: IntakeServing['store'],
    pool: { readonly evaluations: { readonly filters: IntakeServing['filters'] } },
  ) => ServedSubscriptions;
}

export async function toolUsersServedBy(
  runtime: ServingRuntime,
  settings: Settings,
  { registry, connections, offering, goals, results, messages, toolTiming, secrets, now = Date.now }: ToolUsersWiring,
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
    connections: connectionAccessOf(tools.listServers),
    connectionEvents: connectionEventsOf(runtime, settings),
    named: tools.named,
    subscriptionsOver: (store, { evaluations: { filters } }) =>
      subscriptionsOfTheServer(runtime, settings, {
        tools: { ...tools, ...requestWaysOf(registry.tools) },
        secrets,
        takeIn: connectionIntakeServedBy(runtime, { store, filters, providers: settings.providers, now }),
      }),
  };
}
