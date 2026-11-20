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

interface WakingParts extends SocketsServing {
  readonly subscriptions: Awaited<ReturnType<typeof toolUsersServedBy>>['subscriptions'];
}

function wakeUpsOf(
  runtime: ServingRuntime,
  settings: ServedSettings,
  { subscriptions, ...sockets }: WakingParts,
): readonly ReturnType<typeof socketsOfTheServer>[] {
  const following = subscriptions.wakeUpsOver({ streams: sockets.store.database.store });
  return [socketsOfTheServer(runtime, settings, sockets), ...following];
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: ServedSettings,
  database: ProjectedDatabase,
  { projections: wiring, computation, prediction, generation: generating, opens, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  const toolUsers = await toolUsersServedBy(runtime, settings, tools);
  const { reasoning, lookup, interaction, toolOperations, named, subscriptions, ...listing } = toolUsers;
  const generation = await generationServedBy(runtime, settings, generating);
  const { folders, operations, dueWork } = prediction.provided;
  const projections = await wiring.served({ projection: settings.projection, database }, computation.pool, folders);
  const forecaster = await forecasterServedOn(runtime, prediction, projections.store.database);
  const computing = computation.capabilityHolding(heldForCalls(runtime).assets);
  const toolCapabilities = [reasoning.capability, lookup, interaction.capability];
  const capabilities = [...toolCapabilities, computing, forecaster, generation.capability];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  const ownDueWork = [...interaction.dueWorkOf(subscriptions.recording(record)), subscriptions.dueWork];
  const lists = await servedWithTheGoalsEngine(
    { ...tools, goals: tools.results, runtime, database: projections.store.database, pool: computation.pool },
    [...ownDueWork, ...dueWork, ...generation.dueWork],
    [...toolOperations.inPlaybook, ...interaction.operations, ...operations],
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
      wakeUps: wakeUpsOf(runtime, settings, { store: projections.store, secrets: tools.secrets, opens, subscriptions }),
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
  };
}
