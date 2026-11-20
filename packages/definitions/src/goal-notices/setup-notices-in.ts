import type { Notice, PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { contributesIn } from '../contributions/contributes-details.ts';
import { playbookGoalsIn } from '../goals/playbook-goals.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import { isRetired, type StoredDefinition } from '../registry/definition.ts';
import { namingDetailsOf } from '../used-by/definition-users.ts';
import { runsADayOf } from './runs-a-day.ts';
import { goalsSaveNoticesOf, workflowSaveNoticesOf, type SetupWorkflow } from './setup-notices.ts';

type Read<A> = Effect.Effect<A, never, PlaybookReader | PlaybookContext>;

function setupWorkflowOf(stored: StoredDefinition, requests: ReadonlySet<string>): SetupWorkflow {
  const { calls = [] } = namingDetailsOf(stored.details);
  return {
    name: stored.name,
    asks: calls.some(({ type, name }) => type === 'interaction' && requests.has(name)),
    contributes: contributesIn(stored.details) ?? [],
    runsADay: runsADayOf(stored.triggers) ?? 0,
  };
}

const requestsIn: Read<ReadonlySet<string>> = Effect.map(
  loadRegistry('interaction'),
  (registry) =>
    new Set(
      [...registry.values()]
        .filter((stored) => !isRetired(stored) && stored.output_schema !== undefined)
        .map(({ name }) => name),
    ),
);

export const goalsSaveNoticesIn: Read<readonly Notice[]> = Effect.gen(function* () {
  const { goals } = yield* playbookGoalsIn;
  const requests = yield* requestsIn;
  const workflows = [...(yield* loadRegistry('workflow')).values()].filter((stored) => !isRetired(stored));
  return goalsSaveNoticesOf(
    goals,
    workflows.map((stored) => setupWorkflowOf(stored, requests)),
  );
});

export function workflowSaveNoticesIn(stored: StoredDefinition): Read<readonly Notice[]> {
  return Effect.gen(function* () {
    const { goals } = yield* playbookGoalsIn;
    return workflowSaveNoticesOf(goals, setupWorkflowOf(stored, yield* requestsIn));
  });
}
