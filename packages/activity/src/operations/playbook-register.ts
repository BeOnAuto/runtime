import { OrgReader } from '@on.auto/operations';
import { loadRegistry } from '@on.auto/playbooks';
import { Effect } from 'effect';

import {
  changedPositionColumn,
  playbookChangeOf,
  playbookChangeRowsName,
} from '../projections/playbook-change-rows.ts';
import type { ActivityRow } from './activity-row.ts';

export const mostPlaybookChanges = 100;

export interface PlaybookRegister {
  readonly active: ReadonlySet<string>;
  readonly known: ReadonlySet<string>;
  readonly changes: readonly ActivityRow[];
}

export const loadPlaybookRegister: Effect.Effect<PlaybookRegister, never, OrgReader> = Effect.gen(function* () {
  const registry = yield* loadRegistry;
  const newest = yield* (yield* OrgReader).readProjectedRows(playbookChangeRowsName, {
    where: [],
    orderBy: [changedPositionColumn],
    order: 'desc',
    limit: mostPlaybookChanges,
  });
  return {
    active: new Set([...registry.values()].filter(({ status }) => status === 'active').map(({ id }) => id)),
    known: new Set(registry.keys()),
    changes: newest.toReversed().map((row) => playbookChangeOf(row)),
  };
});
