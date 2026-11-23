import { OrgReader, type ProjectedCondition } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

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
import { commentTable, newTable, rowsCountedOf, rowsOwnedBy, type ActivityTable } from './activity-tables.ts';
import { isSeenBy, type Viewer } from './activity-viewer.ts';
import { needsYouIn, type RequestsSetAside } from './needs-you.ts';

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

export function countsIn(viewer: Viewer, playbook: string, setAside: RequestsSetAside) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    return {
      needs_you: yield* needsYouIn(viewer, playbook, setAside),
      broken: yield* reader.countPlaybookRows(playbook, brokenName, [open]),
      new: yield* unseenIn(viewer, newTable, playbook),
      comments: yield* unseenIn(viewer, commentTable, playbook),
    };
  });
}

export interface CountedOfAPlaybook {
  readonly counts: Readonly<Record<string, number>>;
}

export interface CountedActivity {
  readonly viewer: Viewer;
  readonly readable: readonly string[];
  readonly withTheOrg: boolean;
  readonly changes: readonly ActivityRow[];
  readonly ofPlaybooks: readonly CountedOfAPlaybook[];
}

function countsOfTheOrg(viewer: Viewer) {
  return Effect.map(unseenIn(viewer, commentTable, ofTheOrg), (comments) => {
    const counted: ActivityCounts = { needs_you: 0, broken: 0, new: 0, comments };
    return counted;
  });
}

export function summedCount(ofPlaybooks: readonly CountedOfAPlaybook[], name: string): number {
  return ofPlaybooks.reduce((sum, { counts }) => sum + (counts[name] ?? 0), 0);
}

export function countsFor({ viewer, readable, withTheOrg, changes, ofPlaybooks }: CountedActivity) {
  return Effect.gen(function* () {
    const orgCounts = withTheOrg ? yield* countsOfTheOrg(viewer) : undefined;
    const each: readonly CountedOfAPlaybook[] =
      orgCounts === undefined ? ofPlaybooks : [...ofPlaybooks, { counts: { ...orgCounts } }];
    const unseenChanges = changes.filter(
      (change) => readable.includes(change.position.playbook) && !isSeenBy(viewer, change),
    ).length;
    const counts: ActivityCounts = {
      needs_you: summedCount(each, 'needs_you'),
      broken: summedCount(each, 'broken'),
      new: summedCount(each, 'new') + unseenChanges,
      comments: summedCount(each, 'comments'),
    };
    return counts;
  });
}

export const ActivityCountsSchema = Schema.Struct({
  needs_you: Schema.Int.annotate({ description: 'The requests that wait on the caller' }),
  broken: Schema.Int.annotate({ description: 'The broken definitions' }),
  new: Schema.Int.annotate({ description: 'The new rows the caller has not seen' }),
  comments: Schema.Int.annotate({
    description: 'The open comments others made or reopened that the caller has not seen',
  }),
}).annotate({ description: 'What the caller has to look at, over every playbook the caller may access' });
