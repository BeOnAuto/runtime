import type { Goal } from '@on.auto/definitions/goals';
import type { PlaybookReader, ProjectedCondition, ProjectedKeyedRow, ProjectedValue } from '@on.auto/operations';
import type { Effect } from 'effect';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';

export type Rows = readonly ProjectedKeyedRow[];

export interface GoalRows {
  readonly read: (
    where: readonly ProjectedCondition[],
    orderBy: readonly string[],
    order: 'asc' | 'desc',
    limit: number,
  ) => Effect.Effect<Rows>;
  readonly readAfter: (
    where: readonly ProjectedCondition[],
    orderBy: readonly string[],
    order: 'asc' | 'desc',
    page: { readonly limit: number; readonly after: readonly ProjectedValue[] | undefined },
  ) => Effect.Effect<Rows>;
  readonly count: (where: readonly ProjectedCondition[]) => Effect.Effect<number>;
}

export function goalRowsOf(reader: PlaybookReader['Service'], { id }: Pick<Goal, 'id'>): GoalRows {
  const ofGoal = (where: readonly ProjectedCondition[]) => [{ column: 'goal', equals: id }, ...where];
  return {
    read: (where, orderBy, order, limit) =>
      reader.readProjectedRows(assessmentsName, { where: ofGoal(where), orderBy, order, limit }),
    readAfter: (where, orderBy, order, { limit, after }) =>
      reader.readProjectedRows(assessmentsName, {
        where: ofGoal(where),
        orderBy,
        order,
        limit,
        ...(after === undefined ? {} : { after }),
      }),
    count: (where) => reader.countProjectedRows(assessmentsName, ofGoal(where)),
  };
}

export interface DismissedAsked {
  readonly dismissed?: 'include';
}

export type OpenRows = Pick<GoalRows, 'read' | 'count'>;

const open: ProjectedCondition = { column: 'open', equals: true };

const undismissed: ProjectedCondition = { column: 'dismissed', equals: false };

function openShownOf({ dismissed }: DismissedAsked): readonly ProjectedCondition[] {
  return dismissed === 'include' ? [open] : [open, undismissed];
}

export function openRowsOf(rows: GoalRows, asked: DismissedAsked): OpenRows {
  const shown = openShownOf(asked);
  return {
    read: (where, orderBy, order, limit) => rows.read([...shown, ...where], orderBy, order, limit),
    count: (where) => rows.count([...shown, ...where]),
  };
}
