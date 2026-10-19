import type { AppRuntime } from '@on.auto/api';
import type { DispatcherServices } from '@on.auto/operations';
import { playbookOperations } from '@on.auto/playbooks';

import type { Settings } from '../settings/settings.ts';
import type { WorkflowParts } from '../workflows/workflows.ts';
import { factsComposedOf } from './composed-facts.ts';
import type { FunctionWiring } from './function-wiring.ts';
import { computationServedBy } from './served-computation.ts';
import {
  datasetsFolderOf,
  predictionFunctionsServedBy,
  type ServedPredictionFunctions,
} from './served-prediction-functions.ts';
import { toolUsersServedBy, type ToolUsersWiring } from './served-tools.ts';

type LedgerDatabase = Parameters<FunctionWiring['projections']['served']>[1]['database'];

export interface ServedFunctions {
  readonly parts: Omit<WorkflowParts, 'ledger' | 'workflows' | 'identityIssuer' | 'retryStateKeys'>;
  readonly closing: ServedPredictionFunctions['withProcessesClosed'];
}

export async function functionsServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  database: LedgerDatabase,
  { programPoolOf, projections: wiring, ...tools }: FunctionWiring & Pick<ToolUsersWiring, 'connections' | 'offering'>,
): Promise<ServedFunctions> {
  const { reasoning, interaction, toolOperations, withToolsClosed } = await toolUsersServedBy(runtime, settings, tools);
  const computation = await computationServedBy(settings.computation, programPoolOf);
  const projections = await wiring.served(runtime, { recall: settings.recall, database }, computation.pool, [
    datasetsFolderOf(computation.pool),
  ]);
  const prediction = await predictionFunctionsServedBy(runtime, settings, computation.pool, projections.store);
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
      orgOperations: [...playbookOperations, reasoning.listModels, ...toolOperations.inOrg],
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
    closing: (served) => prediction.withProcessesClosed(computation.withPoolClosed(withToolsClosed(served))),
  };
}
