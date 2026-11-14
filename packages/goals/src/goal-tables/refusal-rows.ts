import { recordedDecoder, type KeyedProjection, type ProjectedRow } from '@on.auto/operations';
import { Option } from 'effect';

import { GoalRefusalEventSchema, goalRefusalsKind } from '../goal-facts/goal-facts.ts';
import { noticeDayOf } from './notice-days.ts';

export const refusalsName = 'goal_refusals';

const refusalEventOf = recordedDecoder(GoalRefusalEventSchema);

function refusalsIn(row: ProjectedRow | undefined): number {
  const refusals = row?.['refusals'];
  return typeof refusals === 'number' ? refusals : 0;
}

export type RefusalStatus = 'recorded' | 'standing' | 'new';

interface Refusing {
  readonly run: string;
  readonly detail: string;
}

export function refusalStatus(
  row: ProjectedRow | undefined,
  { run, detail }: Refusing,
  endedAt: number,
): RefusalStatus {
  if (row === undefined) {
    return 'new';
  }
  if (row['run'] === run) {
    return 'recorded';
  }
  const at = row['at'];
  return row['detail'] === detail && typeof at === 'number' && noticeDayOf(at) === noticeDayOf(endedAt)
    ? 'standing'
    : 'new';
}

export const refusalRows: KeyedProjection = {
  name: refusalsName,
  version: 1,
  kinds: [goalRefusalsKind],
  types: ['goal_observation_refused'],
  columns: [
    { name: 'run', kind: 'text' },
    { name: 'detail', kind: 'text' },
    { name: 'at', kind: 'integer' },
    { name: 'refusals', kind: 'integer' },
  ],
  indexes: [],
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.map(refusalEventOf(message), ({ data, context }) => ({
        run: data.run,
        detail: data.detail,
        at: Date.parse(context.at),
        refusals: refusalsIn(row) + 1,
      })),
    ),
};
