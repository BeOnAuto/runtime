import { OrgReader, type ProjectedCondition, type ProjectedRowsQuery } from '@on.auto/operations';
import { Effect } from 'effect';

import { ofTheOrg, resultKeyOf } from '../positions/activity-addresses.ts';
import { cursorOf, newestFirst } from '../positions/activity-position.ts';
import { activityName } from '../projections/activity-rows.ts';
import { seenKinds, type ActivityKind, type ActivityRow } from './activity-row.ts';
import {
  boundsOf,
  commentTable,
  readsAtOnce,
  rowsOwnedBy,
  tiedTimesOf,
  withinBounds,
  type ActivityTable,
  type PageBounds,
} from './activity-tables.ts';
import { commentNamedNow, heldByDefinition, namesAskedBy } from './comment-activity-rows.ts';
import { setAsideIn, type RequestsSetAside } from './needs-you.ts';
import type { PlaybookRegister } from './playbook-register.ts';

const mostRowsTied = 1000;

export interface PageAsked extends PageBounds {
  readonly kinds: ReadonlySet<ActivityKind>;
  readonly playbooks: readonly string[];
  readonly withTheOrg: boolean;
  readonly mine: string | undefined;
  readonly limit: number;
  readonly leftOut: RequestsSetAside;
}

interface Page {
  readonly rows: readonly ActivityRow[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

interface TableRead {
  readonly playbook: string;
  readonly table: ActivityTable;
  readonly where: readonly ProjectedCondition[];
}

function mineIn(table: ActivityTable, mine: string | undefined): readonly ProjectedCondition[] {
  return seenKinds.has(table.kind) && mine !== undefined ? [{ column: 'by', equals: mine }] : [];
}

function rowsRead({ playbook, table, where }: TableRead, limit: number) {
  const query: ProjectedRowsQuery = { where, orderBy: [table.atColumn], order: 'desc', limit };
  return Effect.map(rowsOwnedBy(playbook, table.projection, query), (kept) =>
    kept.flatMap((each) => table.rowsOf(playbook, each)),
  );
}

function tiedAt(read: TableRead, at: number) {
  return rowsRead({ ...read, where: [...read.where, { column: read.table.atColumn, equals: at }] }, mostRowsTied);
}

function leftOutOf(playbook: string, table: ActivityTable, { leftOut }: PageAsked): ReadonlySet<string> {
  return new Set(table.kind === 'needs_you' ? setAsideIn(leftOut, playbook).keys() : []);
}

export function rowsOfTable(playbook: string, table: ActivityTable, asked: PageAsked) {
  return Effect.gen(function* () {
    const read = { playbook, table, where: [{ column: table.openColumn, equals: true }, ...mineIn(table, asked.mine)] };
    const leftOut = leftOutOf(playbook, table, asked);
    const most = asked.limit + leftOut.size;
    const newest = yield* rowsRead({ ...read, where: [...read.where, ...boundsOf(asked, table)] }, most + 1);
    const lowest = newest.length > most ? newest.at(-1)?.position.at : undefined;
    const tied = yield* Effect.forEach(
      new Set([...tiedTimesOf(asked), ...(lowest === undefined ? [] : [lowest])]),
      (at) => tiedAt(read, at),
    );
    const rows = new Map([...newest, ...tied.flat()].map((row) => [row.position.key, row]));
    return [...rows.values()].filter((row) => withinBounds(row, asked) && !leftOut.has(row.position.key));
  });
}

export function startedBy(row: ActivityRow) {
  return Effect.gen(function* () {
    if (row.kind !== 'broken' || row.run_id === null) {
      return row;
    }
    const [started] = yield* (yield* OrgReader).readPlaybookRows(row.position.playbook, activityName, {
      where: [{ column: 'row_key', equals: resultKeyOf(row.run_id) }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    });
    const by = started?.row['by'];
    return typeof by === 'string' ? { ...row, by } : row;
  });
}

export function namedNow(rows: readonly ActivityRow[]) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const read = yield* Effect.forEach(
      namesAskedBy(rows),
      (asked) =>
        Effect.map(reader.namesHeldInPlaybook(asked.playbook, asked.type), (held) => heldByDefinition(asked, held)),
      { concurrency: readsAtOnce },
    );
    const names = new Map(read.flat());
    return rows.map((row) => commentNamedNow(row, names));
  });
}

function changesShown({ changes }: PlaybookRegister, asked: PageAsked): readonly ActivityRow[] {
  return asked.kinds.has('new')
    ? changes.filter(
        (change) =>
          asked.playbooks.includes(change.position.playbook) &&
          (asked.mine === undefined || change.by === asked.mine) &&
          withinBounds(change, asked),
      )
    : [];
}

export interface OfThePlaybooks {
  readonly rows: readonly ActivityRow[];
}

function rowsOfTheOrg(asked: PageAsked) {
  return asked.withTheOrg && asked.kinds.has(commentTable.kind)
    ? Effect.flatMap(rowsOfTable(ofTheOrg, commentTable, asked), namedNow)
    : Effect.succeed([]);
}

export function pageOf(register: PlaybookRegister, asked: PageAsked, ofPlaybooks: readonly OfThePlaybooks[]) {
  return Effect.gen(function* () {
    const merged = [
      ...ofPlaybooks.flatMap(({ rows }) => rows),
      ...(yield* rowsOfTheOrg(asked)),
      ...changesShown(register, asked),
    ].toSorted((left, right) => newestFirst(left.position, right.position));
    const rows = merged.slice(0, asked.limit);
    const hasMore = merged.length > asked.limit;
    const last = rows.at(-1);
    const page: Page = { rows, hasMore, nextCursor: hasMore && last !== undefined ? cursorOf(last.position) : null };
    return page;
  });
}
