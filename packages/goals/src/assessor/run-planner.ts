import type { PlaybookAddress } from '@on.auto/operations';
import { payloadReaderOf } from '@on.auto/operations/payloads';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { runConditionsOf, type ConditionWork } from '../conditions/run-conditions.ts';
import { runOutputsOf } from '../run-outputs/run-outputs.ts';
import { contributedVersionsOf } from './contributed-versions.ts';
import type { PlanParts, PlannedRecord, RunPlan } from './planned-runs.ts';
import { runPlanOf } from './run-plans.ts';

export const mostPlansKept = 4;

export interface AssessorPorts<E> extends Pick<PlanParts<E>, 'ledger' | 'chainsOf' | 'callers'> {
  readonly filters: FilterSandbox;
  readonly now: () => number;
}

export interface AssessorWork {
  readonly plans: number;
  readonly versionReads: number;
  readonly conditions: ConditionWork;
}

interface RunPlanner {
  readonly planOf: (record: PlannedRecord) => Effect.Effect<RunPlan>;
  readonly spent: () => AssessorWork;
}

export function runPlannerOf<E>(ports: AssessorPorts<E>): RunPlanner {
  const versions = contributedVersionsOf();
  const conditions = runConditionsOf(ports.filters);
  const parts = {
    ...ports,
    versions,
    conditions,
    outputsOf: (owner: PlaybookAddress) => runOutputsOf(payloadReaderOf({ owner, content: ports.ledger.content })),
  };
  const kept = new Map<string, RunPlan>();
  const counted = { plans: 0 };
  const remembered = (record: string, plan: RunPlan): RunPlan => {
    kept.delete(record);
    kept.set(record, plan);
    for (const oldest of [...kept.keys()].slice(0, Math.max(0, kept.size - mostPlansKept))) {
      kept.delete(oldest);
    }
    return plan;
  };
  return {
    planOf: (planned) =>
      Effect.suspend(() => {
        const { id } = planned.record;
        const held = kept.get(id);
        if (held !== undefined) {
          return Effect.succeed(remembered(id, held));
        }
        counted.plans += 1;
        return Effect.map(runPlanOf(parts, planned), (plan) => ('unread' in plan ? plan : remembered(id, plan)));
      }),
    spent: () => ({ plans: counted.plans, versionReads: versions.reads(), conditions: conditions.spent() }),
  };
}
