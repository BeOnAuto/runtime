import { foldedBeforeItRuns } from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { ServedWiring } from './function-wiring.ts';
import { generationServedBy } from './served-generation.ts';
import { memoryServedBy } from './served-memory.ts';
import { orgOperationsOfPlaybooks } from './served-org-operations.ts';
import type { ServedReasoning } from './served-reasoning.ts';
import { toolUsersServedBy } from './served-tools.ts';

type ProjectedDatabase = Parameters<ServedWiring['projections']['served']>[0]['database'];

type ServingRuntime = Parameters<typeof toolUsersServedBy>[0] & Parameters<ServedWiring['prediction']['servedIn']>[0];

export interface ServedFunctions {
  readonly parts: Omit<
    WorkflowParts,
    'ledger' | 'workflows' | 'identityIssuer' | 'retryStateKeys' | 'contentAddressKey' | 'shippedFiles'
  >;
}

function reasoningOperationsOf({ listModels, getVoice, transcribe }: ServedReasoning) {
  return [listModels, getVoice, transcribe];
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: Settings,
  database: ProjectedDatabase,
  { projections: wiring, computation, prediction, generation: generating, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  const { reasoning, lookup, interaction, toolOperations } = await toolUsersServedBy(runtime, settings, tools);
  const generation = await generationServedBy(runtime, settings, generating);
  const { capability, folders, operations, dueWork } = prediction.provided;
  const projections = await wiring.served({ projection: settings.projection, database }, computation.pool, folders);
  await prediction.servedIn(runtime, projections.store.database);
  const forecaster = foldedBeforeItRuns({ capability, folders, database: projections.store.database });
  const memory = memoryServedBy(runtime);
  const capabilities = [
    reasoning.capability,
    lookup,
    memory.capability,
    interaction.capability,
    computation.capability,
    forecaster,
    generation.capability,
  ];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  return {
    parts: {
      capabilities,
      facts,
      names,
      pages: projections.pages,
      orgOperations: [
        ...orgOperationsOfPlaybooks(runtime, projections.pages),
        ...reasoningOperationsOf(reasoning),
        ...toolOperations.inOrg,
        ...memory.operations.inOrg,
      ],
      playbookOperations: [
        ...toolOperations.inPlaybook,
        ...interaction.operations,
        ...memory.operations.inPlaybook,
        ...operations,
      ],
      dueWork: [...interaction.dueWorkOf(record), ...dueWork, generation.dueWork],
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
  };
}
