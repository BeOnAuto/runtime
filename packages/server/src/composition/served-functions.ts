import { foldedBeforeItRuns, type HostDatabase } from '@on.auto/workflow-host';

import { servedWithTheGoalsEngine, serverConnectedThrough } from '../goals/goals-engine-lists.ts';
import { socketsOfTheServer, type SocketsServing } from '../sockets/sockets-of-the-server.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { ServedWiring } from './function-wiring.ts';
import { heldForCalls } from './kept-by-runs.ts';
import { generationServedBy } from './served-generation.ts';
import { orgPartsServedBy } from './served-org-operations.ts';
import { toolUsersServedBy } from './served-tools.ts';

type ProjectedDatabase = Parameters<ServedWiring['projections']['served']>[0]['database'];

type ServingRuntime = Parameters<typeof toolUsersServedBy>[0] & Parameters<ServedWiring['prediction']['servedIn']>[0];

type ServedSettings = Parameters<typeof toolUsersServedBy>[1];

export interface ServedFunctions {
  readonly parts: Omit<
    WorkflowParts,
    | 'ledger'
    | 'workflows'
    | 'authorizationServer'
    | 'retryStateKeys'
    | 'contentAddressKey'
    | 'shippedFiles'
    | 'studioAddress'
    | 'holding'
    | 'access'
  >;
}

async function forecasterServedOn(
  runtime: ServingRuntime,
  prediction: ServedWiring['prediction'],
  database: HostDatabase,
) {
  const { capability, folders } = prediction.provided;
  await prediction.servedIn(runtime, database);
  return foldedBeforeItRuns({ capability, folders, database });
}

interface WakingParts extends Pick<SocketsServing, 'opens'> {
  readonly projections: Pick<SocketsServing, 'store'>;
  readonly recorded: Pick<SocketsServing, 'delivered' | 'clicked'>;
  readonly subscriptions: ReturnType<Awaited<ReturnType<typeof toolUsersServedBy>>['subscriptionsOver']>;
  readonly tools: Pick<SocketsServing, 'secrets'> & {
    readonly now?: SocketsServing['now'];
    readonly chatOver?: ServedWiring['chatOver'];
  };
  readonly computation: Pick<ServedWiring['computation'], 'pool'>;
}

function wakeUpsOf(
  runtime: ServingRuntime,
  settings: ServedSettings,
  { subscriptions, tools, computation, projections: { store }, opens, recorded: { delivered, clicked } }: WakingParts,
): readonly ReturnType<typeof socketsOfTheServer>[] {
  const following = subscriptions.wakeUpsOver({ streams: store.database.store });
  const sockets = {
    store,
    opens,
    secrets: tools.secrets,
    identities: subscriptions.identities,
    delivered,
    clicked,
    tools: subscriptions.tools,
    filters: computation.pool.evaluations.filters,
    now: tools.now ?? Date.now,
    chat: tools.chatOver?.({ tools: subscriptions.tools }),
  };
  return [socketsOfTheServer(runtime, settings, sockets), ...following];
}

async function projectionsServed(
  settings: ServedSettings,
  database: ProjectedDatabase,
  { projections: wiring, computation, prediction }: Pick<ServedWiring, 'projections' | 'computation' | 'prediction'>,
  subscriptionsOver: Awaited<ReturnType<typeof toolUsersServedBy>>['subscriptionsOver'],
) {
  const { folders } = prediction.provided;
  const projections = await wiring.served({ projection: settings.projection, database }, computation.pool, folders);
  return { projections, subscriptions: subscriptionsOver(projections.store, computation.pool) };
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: ServedSettings,
  database: ProjectedDatabase,
  { projections: wiring, computation, prediction, generation: generating, opens, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  const { reasoning, lookup, interaction, toolOperations, named, subscriptionsOver, ...listing } =
    await toolUsersServedBy(runtime, settings, tools);
  const generation = await generationServedBy(runtime, settings, generating);
  const served = { projections: wiring, computation, prediction };
  const { projections, subscriptions } = await projectionsServed(settings, database, served, subscriptionsOver);
  const forecaster = await forecasterServedOn(runtime, prediction, projections.store.database);
  const computing = computation.capabilityHolding(heldForCalls(runtime).assets);
  const toolCapabilities = [reasoning.capability, lookup, interaction.capability];
  const capabilities = [...toolCapabilities, computing, forecaster, generation.capability];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  const recorded = interaction.recordedBy(subscriptions.recording(record));
  const lists = await servedWithTheGoalsEngine(
    { ...tools, goals: tools.results, runtime, database: projections.store.database, pool: computation.pool },
    [...recorded.dueWork, subscriptions.dueWork, ...prediction.provided.dueWork, ...generation.dueWork],
    [...toolOperations.inPlaybook, ...interaction.operations, ...prediction.provided.operations],
  );
  return {
    parts: {
      capabilities,
      facts,
      names,
      pages: projections.pages,
      goals: tools.goals,
      results: tools.results,
      messages: tools.messages,
      connected: serverConnectedThrough({ named }),
      askedAbout: interaction.askedAbout,
      ...orgPartsServedBy(
        runtime,
        { goals: tools.goals, messages: tools.messages, pages: projections.pages, ...listing, ...reasoning },
        toolOperations.inOrg,
      ),
      playbookOperations: lists.playbookOperations,
      capabilityOperations: [generation],
      dueWork: lists.dueWork,
      consumers: [...lists.consumers, subscriptions.consumer],
      wakeUps: wakeUpsOf(runtime, settings, { projections, opens, subscriptions, tools, computation, recorded }),
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
  };
}
