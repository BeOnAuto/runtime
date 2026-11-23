import { entitiesOf, readablePlaybooks } from '@on.auto/operations/entities';
import { Array as Arr, Effect } from 'effect';

import { countsIn } from '../operations/activity-counts.ts';
import { rowsInAPage, type DismissedAsked, type ListActivityInput } from '../operations/activity-input.ts';
import type { ActivityKind } from '../operations/activity-row.ts';
import { activityTables } from '../operations/activity-tables.ts';
import type { Viewer } from '../operations/activity-viewer.ts';
import { noneSetAside } from '../operations/needs-you.ts';
import type { ActivityPosition } from '../positions/activity-position.ts';
import {
  playbookActivityKind,
  type ActivityOfAPlaybook,
  type PageOfPlaybooks,
  type PlaybookActivityKind,
  type SetAsideOfAPlaybook,
} from './playbook-activity.ts';

export type ActivityOfPlaybooksKind = PlaybookActivityKind;

export const activityOfPlaybooksToday: PlaybookActivityKind = playbookActivityKind({
  name: 'playbook_activity',
  tables: activityTables,
  countsIn,
  setAsideIn: () => Effect.succeed(new Map()),
});

interface ReadableActivity {
  readonly readable: readonly string[];
  readonly ofPlaybooks: readonly ActivityOfAPlaybook[];
}

export interface ActivityAsked {
  readonly viewer: Viewer;
  readonly page: PageOfPlaybooks | null;
  readonly pagedOf: (readable: readonly string[]) => readonly string[];
}

export function activityOfReadablePlaybooks(
  kind: PlaybookActivityKind,
  active: Iterable<string>,
  asked: ActivityAsked,
) {
  return Effect.gen(function* () {
    const readable = yield* readablePlaybooks(active);
    const { viewer, page, pagedOf } = asked;
    const ofPlaybooks = yield* entitiesOf(kind, readable, { viewer, page, paged: pagedOf(readable) });
    const read: ReadableActivity = { readable, ofPlaybooks };
    return read;
  });
}

export interface SetAsideOfTheCall {
  readonly every: ReadonlyMap<string, SetAsideOfAPlaybook>;
  readonly leftOut: ReadonlyMap<string, SetAsideOfAPlaybook>;
  readonly shown: ReadonlyMap<string, SetAsideOfAPlaybook>;
}

export function setAsideOfThe(
  readable: readonly string[],
  ofPlaybooks: readonly ActivityOfAPlaybook[],
  dismissed: boolean,
): SetAsideOfTheCall {
  const every = new Map(Arr.zipWith(readable, ofPlaybooks, (playbook, { setAside }) => [playbook, setAside] as const));
  return { every, leftOut: dismissed ? noneSetAside : every, shown: dismissed ? every : noneSetAside };
}

export function pageOfPlaybooks(
  input: ListActivityInput & DismissedAsked,
  kinds: ReadonlySet<ActivityKind>,
  caller: string,
) {
  return (cursor: ActivityPosition | undefined, since: ActivityPosition | undefined): PageOfPlaybooks => ({
    kinds: [...kinds],
    mine: input.mine === true ? caller : null,
    limit: input.limit ?? rowsInAPage,
    cursor: cursor ?? null,
    since: since ?? null,
    dismissed: input.dismissed === 'include',
  });
}
