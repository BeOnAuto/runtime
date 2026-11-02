import { foldedBeforeItRuns } from '@on.auto/workflow-host';

import type { ProvidedOnceServed } from '../capability-registry/served-ports.ts';
import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { FunctionWiring } from './function-wiring.ts';
import type { ServedComputation } from './served-computation.ts';
import { memoryServedBy } from './served-memory.ts';
import { orgOperationsOfPlaybooks } from './served-org-operations.ts';
import { toolUsersServedBy, type ToolUsersWiring } from './served-tools.ts';

type ProjectedDatabase = Parameters<FunctionWiring['projections']['served']>[0]['database'];

type ServingRuntime = Parameters<typeof toolUsersServedBy>[0] & Parameters<ProvidedOnceServed['servedIn']>[0];

interface ServedWiring extends Omit<FunctionWiring, 'programPoolOf'>, ToolUsersWiring {
  readonly computation: ServedComputation;
  readonly prediction: ProvidedOnceServed;
}

export interface ServedFunctions {
  readonly parts: Omit<
    WorkflowParts,
    'ledger' | 'workflows' | 'identityIssuer' | 'retryStateKeys' | 'contentAddressKey' | 'shippedFiles'
  >;
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: Settings,
  database: ProjectedDatabase,
  { projections: wiring, computation, prediction, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  const { reasoning, lookup, interaction, toolOperations } = await toolUsersServedBy(runtime, settings, tools);
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
    projections.page,
  ];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  return {
    parts: {
      capabilities,
      facts,
      names,
      orgOperations: [
        ...orgOperationsOfPlaybooks,
        reasoning.listModels,
        ...toolOperations.inOrg,
        ...memory.operations.inOrg,
      ],
      playbookOperations: [
        ...toolOperations.inPlaybook,
        ...interaction.operations,
        ...memory.operations.inPlaybook,
        ...operations,
      ],
      dueWork: [...interaction.dueWorkOf(record), ...dueWork],
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
  };
}
