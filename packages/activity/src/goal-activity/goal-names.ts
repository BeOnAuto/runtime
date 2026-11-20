import { goalType } from '@on.auto/definitions/goals';
import { OrgReader } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ActivityRow } from '../operations/activity-row.ts';
import { readsAtOnce } from '../operations/activity-tables.ts';

export type GoalNames = ReadonlyMap<string, string>;

export function goalNamesOfRows(rows: readonly ActivityRow[]): Effect.Effect<GoalNames, never, OrgReader> {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const playbooks = [
      ...new Set(rows.filter(({ goal }) => goal !== undefined).map(({ position }) => position.playbook)),
    ];
    const held = yield* Effect.forEach(playbooks, (playbook) => reader.namesHeldInPlaybook(playbook, goalType), {
      concurrency: readsAtOnce,
    });
    const names: GoalNames = new Map(held.flat().map(({ definitionKey, name }) => [definitionKey, name]));
    return names;
  });
}
