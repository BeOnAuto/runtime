import type { AppRuntime } from '@on.auto/api';
import { goalsHostPartsWhere, type GoalsHostParts, type GoalsOperation, type GoalsPorts } from '@on.auto/goals';
import { Ledger, PlaybookRegistry } from '@on.auto/operations';
import type { Evaluations } from '@on.auto/workflow-engine';
import type { DueWork, FollowerConsumers } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from '../workflows/in-runtime.ts';

interface HostLists {
  readonly consumers: FollowerConsumers;
  readonly dueWork: readonly DueWork[];
}

export function hostListsWithTheGoalsEngine(own: HostLists, engine: GoalsHostParts): HostLists {
  return { consumers: [...own.consumers, ...engine.consumers], dueWork: [...own.dueWork, ...engine.dueWork] };
}

const nodeCallers: GoalsPorts['callers'] = { serviceCallers: new Set() };

export type GoalsPortsOver = (ports: GoalsPorts) => GoalsPorts;

const portsAsHeld: GoalsPortsOver = (ports) => ports;

interface ServingGoals extends Pick<GoalsPorts, 'database'> {
  readonly goals: boolean;
  readonly pool: { readonly evaluations: Pick<Evaluations, 'filters'> };
  readonly runtime: AppRuntime<Ledger | PlaybookRegistry>;
  readonly now?: (() => number) | undefined;
  readonly goalsPortsOver?: GoalsPortsOver | undefined;
}

export async function servedWithTheGoalsEngine<Operation extends GoalsOperation>(
  { goals, runtime, now = Date.now, database, pool, goalsPortsOver = portsAsHeld }: ServingGoals,
  dueWork: readonly DueWork[],
  playbookOperations: readonly Operation[],
): Promise<HostLists & { readonly playbookOperations: readonly (Operation | GoalsOperation)[] }> {
  const ledger = await Effect.runPromise(inRuntime(runtime, Effect.service(Ledger)));
  const registry = await Effect.runPromise(inRuntime(runtime, Effect.service(PlaybookRegistry)));
  const engine = goalsHostPartsWhere(goals, () =>
    goalsPortsOver({ database, ledger, registry, callers: nodeCallers, filters: pool.evaluations.filters, now }),
  );
  return {
    ...hostListsWithTheGoalsEngine({ consumers: [], dueWork }, engine),
    playbookOperations: [...playbookOperations, ...engine.playbookOperations],
  };
}
