import { OrgReader, type ProjectedCondition } from '@on.auto/operations';
import { Effect } from 'effect';

import { resultKeyOf } from '../positions/activity-addresses.ts';
import { newestFirst } from '../positions/activity-position.ts';
import { activityName } from '../projections/activity-rows.ts';
import { seenKinds, type ActivityKind, type ActivityRow } from './activity-row.ts';
import {
  activityTables,
  boundsOf,
  tiedTimesOf,
  withinBounds,
  type ActivityTable,
  type PageBounds,
} from './activity-tables.ts';
import type { PlaybookRegister } from './playbook-register.ts';

const mostRowsTied = 1000;

export interface PageAsked extends PageBounds {
  readonly kinds: ReadonlySet<ActivityKind>;
  readonly playbooks: readonly string[];
  readonly mine: string | undefined;
  readonly limit: number;
}

interface Page {
  readonly rows: readonly ActivityRow[];
  readonly hasMore: boolean;
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
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    const kept = yield* reader.readPlaybookRows(playbook, table.projection, {
      where,
      orderBy: ['at'],
      order: 'desc',
      limit,
    });
    return kept.flatMap((each) => table.rowsOf(playbook, each));
  });
}

function tiedAt(read: TableRead, at: number) {
  return rowsRead({ ...read, where: [...read.where, { column: 'at', equals: at }] }, mostRowsTied);
}

function rowsOfTable(playbook: string, table: ActivityTable, asked: PageAsked) {
  return Effect.gen(function* () {
    const read = { playbook, table, where: [{ column: table.openColumn, equals: true }, ...mineIn(table, asked.mine)] };
    const newest = yield* rowsRead({ ...read, where: [...read.where, ...boundsOf(asked)] }, asked.limit + 1);
    const lowest = newest.length > asked.limit ? newest.at(-1)?.position.at : undefined;
    const tied = yield* Effect.forEach(
      new Set([...tiedTimesOf(asked), ...(lowest === undefined ? [] : [lowest])]),
      (at) => tiedAt(read, at),
    );
    const rows = new Map([...newest, ...tied.flat()].map((row) => [row.position.key, row]));
    return [...rows.values()].filter((row) => withinBounds(row, asked));
  });
}

function startedBy(row: ActivityRow) {
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

export function pageOf(register: PlaybookRegister, asked: PageAsked) {
  return Effect.gen(function* () {
    const tables = activityTables.filter(({ kind }) => asked.kinds.has(kind));
    const read = yield* Effect.forEach(asked.playbooks, (playbook) =>
      Effect.forEach(tables, (table) => rowsOfTable(playbook, table, asked)),
    );
    const merged = [...read.flat(2), ...changesShown(register, asked)].toSorted((left, right) =>
      newestFirst(left.position, right.position),
    );
    const rows = yield* Effect.forEach(merged.slice(0, asked.limit), startedBy);
    const page: Page = { rows, hasMore: merged.length > asked.limit };
    return page;
  });
}
