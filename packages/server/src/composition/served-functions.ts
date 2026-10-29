import { connectionChanges } from '@on.auto/connections';
import { defineListOrgChanges, playbookChanges, playbookOperations } from '@on.auto/playbooks';

import { extensionsServedBy } from '../extensions/served-extensions.ts';
import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { FunctionWiring } from './function-wiring.ts';
import { computationServedBy } from './served-computation.ts';
import {
  datasetsFolderOf,
  predictionExtensionPoints,
  predictionFunctionsServedBy,
  type ServedPredictionFunctions,
} from './served-prediction-functions.ts';
import { toolUsersServedBy, type ToolUsersWiring } from './served-tools.ts';

const orgChanges = defineListOrgChanges([playbookChanges, connectionChanges]);

type ProjectedDatabase = Parameters<FunctionWiring['projections']['served']>[0]['database'];

type ServingRuntime = Parameters<typeof toolUsersServedBy>[0];

type LicensedFeatures = Parameters<typeof predictionFunctionsServedBy>[3]['features'];

type ShippedFiles = Parameters<typeof computationServedBy>[2];

interface ServedWiring extends FunctionWiring, ToolUsersWiring {
  readonly shippedFiles: ShippedFiles;
  readonly features: LicensedFeatures;
  readonly installed?: Parameters<typeof extensionsServedBy>[3];
}

export interface ServedFunctions {
  readonly parts: Omit<WorkflowParts, 'ledger' | 'workflows' | 'identityIssuer' | 'retryStateKeys' | 'shippedFiles'>;
  readonly closing: ServedPredictionFunctions['withProcessesClosed'];
}

export async function functionsServedBy(
  runtime: ServingRuntime,
  settings: Settings,
  database: ProjectedDatabase,
  { programPoolOf, projections: wiring, shippedFiles, features, installed, ...tools }: ServedWiring,
): Promise<ServedFunctions> {
  const extensions = await extensionsServedBy(runtime, settings.extensions, predictionExtensionPoints, installed);
  const { reasoning, interaction, toolOperations } = await toolUsersServedBy(runtime, settings, tools);
  const computation = await computationServedBy(settings.computation, programPoolOf, shippedFiles);
  const projections = await wiring.served({ recall: settings.recall, database }, computation.pool, [
    datasetsFolderOf(computation.pool),
  ]);
  const prediction = await predictionFunctionsServedBy(runtime, settings, computation.pool, {
    store: projections.store,
    provided: extensions.provided,
    features,
    modelProcesses: tools.registry.processes.pool,
  });
  const capabilities = [
    reasoning.capability,
    interaction.capability,
    computation.capability,
    projections.recall,
    prediction.capability,
  ];
  const { facts, names, record } = factsComposedOf(runtime, capabilities);
  return {
    parts: {
      capabilities,
      facts,
      names,
      orgOperations: [...playbookOperations, orgChanges, reasoning.listModels, ...toolOperations.inOrg],
      playbookOperations: [
        ...toolOperations.inPlaybook,
        ...interaction.operationsFor(capabilities),
        ...prediction.routes,
      ],
      dueWork: [...interaction.dueWorkOf(record), prediction.dueWorkFor(capabilities)],
      store: projections.store,
      projector: projections.projector,
      evaluations: computation.pool.evaluations,
      check: computation.check,
    },
    closing: (served) => prediction.withProcessesClosed(computation.withPoolClosed(served)),
  };
}
