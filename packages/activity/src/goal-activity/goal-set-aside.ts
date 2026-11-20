import { goalType } from '@on.auto/definitions/goals';
import {
  OrgReader,
  type BoundProjectionReader,
  type ProjectedCondition,
  type ProjectedRowsQuery,
} from '@on.auto/operations';
import type { PlaybookGoals } from '@on.auto/playbooks';
import { Effect } from 'effect';

import type { SetAsideOf } from '../operations/activity-counts.ts';
import { readsAtOnce } from '../operations/activity-tables.ts';
import type { OpenRequestSetAside, RequestSetAside } from '../operations/needs-you.ts';
import { requestsName } from '../projections/request-rows.ts';

interface NamedGoal {
  readonly definitionKey: string;
  readonly name: string;
}

interface GoalRowsOfAPlaybook {
  readonly read: BoundProjectionReader['readProjectedRows'];
  readonly goalNames: Effect.Effect<readonly NamedGoal[]>;
}

export type StandingSetAside = (rows: GoalRowsOfAPlaybook) => Effect.Effect<ReadonlyMap<string, RequestSetAside>>;

export interface GoalsRead {
  readonly read: PlaybookGoals['read'];
  readonly setAside: StandingSetAside;
}

const open: ProjectedCondition = { column: 'open', equals: true };

function openRowsWhere(where: readonly ProjectedCondition[], limit: number): ProjectedRowsQuery {
  return { where: [open, ...where], orderBy: [], order: 'asc', limit };
}

type SetAsideOfAPlaybook = readonly [string, ReadonlyMap<string, OpenRequestSetAside>];

function openRequestsAmong(playbook: string, keys: readonly string[]) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const opened = yield* reader.countPlaybookRows(playbook, requestsName, [open]);
    if (opened <= keys.length) {
      return yield* reader.readPlaybookRows(playbook, requestsName, openRowsWhere([], opened + 1));
    }
    const each = yield* Effect.forEach(
      keys,
      (key) => reader.readPlaybookRows(playbook, requestsName, openRowsWhere([{ column: 'row_key', equals: key }], 1)),
      { concurrency: readsAtOnce },
    );
    return each.flat();
  });
}

function openSetAsideIn(playbook: string, standing: StandingSetAside) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const setAside = yield* standing({
      read: (projection, query) => reader.readPlaybookRows(playbook, projection, query),
      goalNames: reader.namesHeldInPlaybook(playbook, goalType),
    });
    const requests = setAside.size === 0 ? [] : yield* openRequestsAmong(playbook, [...setAside.keys()]);
    const kept = requests.flatMap(({ key, row }): readonly (readonly [string, OpenRequestSetAside])[] => {
      const mark = setAside.get(key);
      return mark === undefined ? [] : [[key, { waitsOn: String(row['waits_on']), setAside: mark }]];
    });
    const ofThePlaybook: SetAsideOfAPlaybook = [playbook, new Map(kept)];
    return ofThePlaybook;
  });
}

export function setAsideOfGoals(standing: StandingSetAside): SetAsideOf {
  return (playbooks) =>
    Effect.map(
      Effect.forEach(playbooks, (playbook) => openSetAsideIn(playbook, standing), { concurrency: readsAtOnce }),
      (each: readonly SetAsideOfAPlaybook[]) => new Map(each),
    );
}
