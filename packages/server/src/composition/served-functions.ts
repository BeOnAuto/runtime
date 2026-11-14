import { foldedBeforeItRuns } from '@on.auto/workflow-host';

import { servedWithTheGoalsEngine } from '../goals/goals-engine-lists.ts';
import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { ServedWiring } from './function-wiring.ts';
import { generationServedBy } from './served-generation.ts';
import { orgPartsServedBy } from './served-org-operations.ts';
import { toolUsersServedBy } from './served-tools.ts';

type ProjectedDatabase = Parameters<ServedWiring['projections']['served']>[0]['database'];

type ServingRuntime = Parameters<typeof toolUsersServedBy>[0] & Parameters<ServedWiring['prediction']['servedIn']>[0];

export interface ServedFunctions {
  readonly parts: Omit<
    WorkflowParts,
    | 'ledger'
    | 'workflows'
    | 'identityIssuer'
    | 'retryStateKeys'
    | 'contentAddressKey'
    | 'shippedFiles'
    | 'studioAddress'
  >;
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: Settings,
  database: ProjectedDatabase,
  { projections: wiring, computation, prediction, generation: generating, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  const { goals, results, messages } = tools;
  const toolUsers = await toolUsersServedBy(runtime, settings, tools);
  const { reasoning, lookup, interaction, toolOperations, ...listing } = toolUsers;
  const generation = await generationServedBy(runtime, settings, generating);
  const { capability, folders, operations, dueWork } = prediction.provided;
  const projections = await wiring.served({ projection: settings.projection, database }, computation.pool, folders);
  await prediction.servedIn(runtime, projections.store.database);
  const forecaster = foldedBeforeItRuns({ capability, folders, database: projections.store.database });
  const toolCapabilities = [reasoning.capability, lookup, interaction.capability];
  const capabilities = [...toolCapabilities, computation.capability, forecaster, generation.capability];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  const lists = await servedWithTheGoalsEngine(
    { ...tools, goals: results, runtime, database: projections.store.database, pool: computation.pool },
    [...interaction.dueWorkOf(record), ...dueWork, ...generation.dueWork],
    [...toolOperations.inPlaybook, ...interaction.operations, ...operations],
  );
  return {
    parts: {
      capabilities,
      facts,
      names,
      pages: projections.pages,
      goals,
      results,
      messages,
      ...orgPartsServedBy(
        runtime,
        { goals, messages, pages: projections.pages, ...listing, ...reasoning },
        toolOperations.inOrg,
      ),
      playbookOperations: lists.playbookOperations,
      capabilityOperations: [generation],
      dueWork: lists.dueWork,
      consumers: lists.consumers,
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
  };
}
