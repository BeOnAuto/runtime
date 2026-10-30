import { extensionsServedBy } from '../extensions/served-extensions.ts';
import type { ServedClosing } from '../server-options/server-options.ts';
import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { FunctionWiring } from './function-wiring.ts';
import { computationServedBy } from './served-computation.ts';
import { orgOperationsOfPlaybooks } from './served-org-operations.ts';
import { datasetsFolderOf, predictionFunctionsServedBy } from './served-prediction-functions.ts';
import { toolUsersServedBy, type ToolUsersWiring } from './served-tools.ts';

type ProjectedDatabase = Parameters<FunctionWiring['projections']['served']>[0]['database'];

type ServingRuntime = Parameters<typeof toolUsersServedBy>[0];

type ShippedFiles = Parameters<typeof computationServedBy>[2];

interface ServedWiring extends FunctionWiring, ToolUsersWiring {
  readonly shippedFiles: ShippedFiles;
  readonly installed?: Parameters<typeof extensionsServedBy>[2];
}

export interface ServedFunctions {
  readonly parts: Omit<WorkflowParts, 'ledger' | 'workflows' | 'identityIssuer' | 'retryStateKeys' | 'shippedFiles'>;
  readonly closing: ServedClosing;
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: Settings,
  database: ProjectedDatabase,
  { programPoolOf, projections: wiring, shippedFiles, installed, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  await extensionsServedBy(runtime, settings.extensions, installed);
  const { reasoning, interaction, toolOperations } = await toolUsersServedBy(runtime, settings, tools);
  const computation = await computationServedBy(settings.computation, programPoolOf, shippedFiles);
  const projections = await wiring.served({ recall: settings.recall, database }, computation.pool, [
    datasetsFolderOf(computation.pool),
  ]);
  const capabilities = [
    reasoning.capability,
    interaction.capability,
    computation.capability,
    projections.recall,
    predictionFunctionsServedBy(settings, computation.pool, projections.store),
  ];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  return {
    parts: {
      capabilities,
      facts,
      names,
      orgOperations: [...orgOperationsOfPlaybooks, reasoning.listModels, ...toolOperations.inOrg],
      playbookOperations: [...toolOperations.inPlaybook, ...interaction.operations],
      dueWork: interaction.dueWorkOf(record),
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
    closing: computation.withPoolClosed,
  };
}
