import { OrgReader, type ProjectedCondition } from '@on.auto/operations';
import { Effect } from 'effect';

import { goalVerdictTable } from '../goal-activity/goal-tables.ts';
import {
  itemOfAnyAddress,
  ofTheOrg,
  orgSegment,
  type ActivityItem,
  type ItemForm,
} from '../positions/activity-addresses.ts';
import { brokenName } from '../projections/broken-rows.ts';
import type { Mark } from '../projections/seen-rows.ts';
import type { ActivityRow } from './activity-row.ts';
import {
  commentTable,
  newTable,
  readsAtOnce,
  rowsCountedOf,
  rowsOwnedBy,
  type ActivityTable,
} from './activity-tables.ts';
import { isSeenBy, type Viewer } from './activity-viewer.ts';
import { needsYouIn, noneSetAside, type RequestsSetAside } from './needs-you.ts';

export interface ActivityCounts {
  readonly needs_you: number;
  readonly broken: number;
  readonly new: number;
  readonly comments: number;
}

const open: ProjectedCondition = { column: 'open', equals: true };

const tablesOfForms: Readonly<Partial<Record<ItemForm, ActivityTable>>> = {
  result: newTable,
  version: newTable,
  comment: commentTable,
  assessment: goalVerdictTable,
};

function openIn(table: ActivityTable): ProjectedCondition {
  return { column: table.openColumn, equals: true };
}

function isOwnedBy(item: ActivityItem, owner: string): boolean {
  return owner === ofTheOrg ? item.playbook === orgSegment && item.form === 'comment' : item.playbook === owner;
}

function isCountedMark(viewer: Viewer, table: ActivityTable, playbook: string, mark: Mark) {
  return Effect.gen(function* () {
    const item = itemOfAnyAddress(mark.address);
    if (item === undefined || !isOwnedBy(item, playbook) || tablesOfForms[item.form] !== table) {
      return false;
    }
    const [kept] = yield* rowsOwnedBy(playbook, table.projection, {
      where: [openIn(table), { column: 'row_key', equals: table.rowKeyOf(item.key) }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    });
    const at = kept?.row[table.atColumn];
    return (
      typeof at === 'number' &&
      at > viewer.through.at &&
      at <= mark.at &&
      kept?.row[table.seenByColumn] !== viewer.caller
    );
  });
}

function unseenTiedIn(viewer: Viewer, table: ActivityTable, playbook: string) {
  return Effect.gen(function* () {
    const tied = yield* rowsOwnedBy(playbook, table.projection, {
      where: [openIn(table), { column: table.atColumn, equals: viewer.through.at }],
      orderBy: [],
      order: 'asc',
      limit: 1000,
    });
    return tied.flatMap((each) => table.rowsOf(playbook, each)).filter((row) => !isSeenBy(viewer, row)).length;
  });
}

export function unseenIn(viewer: Viewer, table: ActivityTable, playbook: string) {
  return Effect.gen(function* () {
    const after: ProjectedCondition = { column: table.atColumn, after: viewer.through.at };
    const all = yield* rowsCountedOf(playbook, table.projection, [openIn(table), after]);
    const own = yield* rowsCountedOf(playbook, table.projection, [
      openIn(table),
      { column: table.seenByColumn, equals: viewer.caller },
      after,
    ]);
    const marks = viewer.seen.marks.filter(({ at }) => at > viewer.through.at);
    const marked = yield* Effect.forEach(marks, (mark) => isCountedMark(viewer, table, playbook, mark));
    const tied = yield* unseenTiedIn(viewer, table, playbook);
    return all - own - marked.filter(Boolean).length + tied;
  });
}

function countsIn(viewer: Viewer, playbook: string, setAside: RequestsSetAside) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const counted: ActivityCounts = {
      needs_you: yield* needsYouIn(viewer, playbook, setAside),
      broken: yield* reader.countPlaybookRows(playbook, brokenName, [open]),
      new: yield* unseenIn(viewer, newTable, playbook),
      comments: yield* unseenIn(viewer, commentTable, playbook),
    };
    return counted;
  });
}

export interface CountedActivity {
  readonly viewer: Viewer;
  readonly readable: readonly string[];
  readonly withTheOrg: boolean;
  readonly changes: readonly ActivityRow[];
  readonly setAside: RequestsSetAside;
}

export type SetAsideOf = (playbooks: readonly string[]) => Effect.Effect<RequestsSetAside, never, OrgReader>;

export const noneSetAsideOf: SetAsideOf = () => Effect.succeed(noneSetAside);

function countsOfTheOrg(viewer: Viewer) {
  return Effect.map(unseenIn(viewer, commentTable, ofTheOrg), (comments) => {
    const counted: ActivityCounts = { needs_you: 0, broken: 0, new: 0, comments };
    return counted;
  });
}

export function countsFor({ viewer, readable, withTheOrg, changes, setAside }: CountedActivity) {
  return Effect.gen(function* () {
    const ofPlaybooks = yield* Effect.forEach(readable, (playbook) => countsIn(viewer, playbook, setAside), {
      concurrency: readsAtOnce,
    });
    const each = withTheOrg ? [...ofPlaybooks, yield* countsOfTheOrg(viewer)] : ofPlaybooks;
    const unseenChanges = changes.filter(
      (change) => readable.includes(change.position.playbook) && !isSeenBy(viewer, change),
    ).length;
    const counts: ActivityCounts = {
      needs_you: each.reduce((sum, { needs_you: count }) => sum + count, 0),
      broken: each.reduce((sum, { broken }) => sum + broken, 0),
      new: each.reduce((sum, counted) => sum + counted.new, unseenChanges),
      comments: each.reduce((sum, { comments }) => sum + comments, 0),
    };
    return counts;
  });
}
