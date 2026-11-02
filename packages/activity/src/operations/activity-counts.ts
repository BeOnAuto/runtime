import { OrgReader, type ProjectedCondition } from '@on.auto/operations';
import { Effect } from 'effect';

import { itemOfAddress } from '../positions/activity-addresses.ts';
import { activityName } from '../projections/activity-rows.ts';
import { brokenName } from '../projections/broken-rows.ts';
import { anyMember, requestsName } from '../projections/request-rows.ts';
import type { Mark } from '../projections/seen-rows.ts';
import type { ActivityRow } from './activity-row.ts';
import { newTable } from './activity-tables.ts';
import { isSeenBy, type Viewer } from './activity-viewer.ts';

const localDeveloper = 'local';

interface ActivityCounts {
  readonly needs_you: number;
  readonly broken: number;
  readonly new: number;
}

const open: ProjectedCondition = { column: 'open', equals: true };

const listed: ProjectedCondition = { column: 'listed', equals: true };

function needsYouIn(viewer: Viewer, playbook: string) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    if (viewer.caller === localDeveloper) {
      return yield* reader.countPlaybookRows(playbook, requestsName, [open]);
    }
    const waitingOn = (party: string) =>
      reader.countPlaybookRows(playbook, requestsName, [open, { column: 'waits_on', equals: party }]);
    const anyone = yield* waitingOn(anyMember);
    const named = viewer.address === undefined ? 0 : yield* waitingOn(viewer.address);
    return anyone + named;
  });
}

function isCountedMark(viewer: Viewer, playbook: string, mark: Mark) {
  return Effect.gen(function* () {
    const item = itemOfAddress(mark.address);
    if (item?.playbook !== playbook || (item.form !== 'result' && item.form !== 'version')) {
      return false;
    }
    const [kept] = yield* (yield* OrgReader).readPlaybookRows(playbook, activityName, {
      where: [listed, { column: 'row_key', equals: item.key }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    });
    const at = kept?.row['at'];
    return typeof at === 'number' && at > viewer.through.at && kept?.row['by'] !== viewer.caller;
  });
}

function unseenTiedIn(viewer: Viewer, playbook: string) {
  return Effect.gen(function* () {
    const tied = yield* (yield* OrgReader).readPlaybookRows(playbook, activityName, {
      where: [listed, { column: 'at', equals: viewer.through.at }],
      orderBy: [],
      order: 'asc',
      limit: 1000,
    });
    return tied.flatMap((each) => newTable.rowsOf(playbook, each)).filter((row) => !isSeenBy(viewer, row)).length;
  });
}

function newIn(viewer: Viewer, playbook: string) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const after: ProjectedCondition = { column: 'at', after: viewer.through.at };
    const all = yield* reader.countPlaybookRows(playbook, activityName, [listed, after]);
    const own = yield* reader.countPlaybookRows(playbook, activityName, [
      listed,
      { column: 'by', equals: viewer.caller },
      after,
    ]);
    const marks = viewer.seen.marks.filter(({ at }) => at > viewer.through.at);
    const marked = yield* Effect.forEach(marks, (mark) => isCountedMark(viewer, playbook, mark));
    const tied = yield* unseenTiedIn(viewer, playbook);
    return all - own - marked.filter(Boolean).length + tied;
  });
}

function countsIn(viewer: Viewer, playbook: string) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const counted: ActivityCounts = {
      needs_you: yield* needsYouIn(viewer, playbook),
      broken: yield* reader.countPlaybookRows(playbook, brokenName, [open]),
      new: yield* newIn(viewer, playbook),
    };
    return counted;
  });
}

export interface CountedActivity {
  readonly viewer: Viewer;
  readonly readable: readonly string[];
  readonly changes: readonly ActivityRow[];
}

export function countsFor({ viewer, readable, changes }: CountedActivity) {
  return Effect.gen(function* () {
    const each = yield* Effect.forEach(readable, (playbook) => countsIn(viewer, playbook));
    const unseenChanges = changes.filter(
      (change) => readable.includes(change.position.playbook) && !isSeenBy(viewer, change),
    ).length;
    const counts: ActivityCounts = {
      needs_you: each.reduce((sum, { needs_you: count }) => sum + count, 0),
      broken: each.reduce((sum, { broken }) => sum + broken, 0),
      new: each.reduce((sum, counted) => sum + counted.new, unseenChanges),
    };
    return counts;
  });
}
