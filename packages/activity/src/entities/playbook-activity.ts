import { goalType } from '@on.auto/definitions/goals';
import { OrgReader } from '@on.auto/operations';
import { type EntityKind } from '@on.auto/operations/entities';
import { Effect, Schema } from 'effect';

import { namedNow, rowsOfTable, startedBy, type PageAsked } from '../operations/activity-page.ts';
import type { ActivityRow } from '../operations/activity-row.ts';
import { readsAtOnce, type ActivityTable } from '../operations/activity-tables.ts';
import type { Viewer } from '../operations/activity-viewer.ts';
import { noneSetAside, type OpenRequestSetAside, type RequestsSetAside } from '../operations/needs-you.ts';
import { ActivityOfAPlaybookSchema, PlaybookActivityAskedSchema, type PageOfPlaybooksSchema } from './activity-wire.ts';

export type PageOfPlaybooks = typeof PageOfPlaybooksSchema.Type;

type PlaybookActivityAsked = typeof PlaybookActivityAskedSchema.Type;

export type ActivityOfAPlaybook = typeof ActivityOfAPlaybookSchema.Type;

type PlaybookCounts = Readonly<Record<string, number>>;

export type SetAsideOfAPlaybook = ReadonlyMap<string, OpenRequestSetAside>;

export interface PlaybookActivityReading {
  readonly name: string;
  readonly tables: readonly ActivityTable[];
  readonly countsIn: (
    viewer: Viewer,
    playbook: string,
    setAside: RequestsSetAside,
  ) => Effect.Effect<PlaybookCounts, never, OrgReader>;
  readonly setAsideIn: (playbook: string) => Effect.Effect<SetAsideOfAPlaybook, never, OrgReader>;
}

export type PlaybookActivityKind = EntityKind<string, ActivityOfAPlaybook, PlaybookActivityAsked>;

const noGoalNames: ReadonlyMap<string, string> = new Map();

function pageAskedOf(playbook: string, page: PageOfPlaybooks, setAside: SetAsideOfAPlaybook): PageAsked {
  return {
    kinds: new Set(page.kinds),
    playbooks: [playbook],
    withTheOrg: false,
    mine: page.mine ?? undefined,
    limit: page.limit,
    cursor: page.cursor ?? undefined,
    since: page.since ?? undefined,
    leftOut: page.dismissed ? noneSetAside : new Map([[playbook, setAside]]),
  };
}

function pageRowsOf(
  tables: readonly ActivityTable[],
  playbook: string,
  page: PageOfPlaybooks,
  setAside: SetAsideOfAPlaybook,
) {
  return Effect.gen(function* () {
    const asked = pageAskedOf(playbook, page, setAside);
    const read = yield* Effect.forEach(
      tables.filter(({ kind }) => asked.kinds.has(kind)),
      (table) => rowsOfTable(playbook, table, asked),
      { concurrency: readsAtOnce },
    );
    return yield* namedNow(yield* Effect.forEach(read.flat(), startedBy, { concurrency: readsAtOnce }));
  });
}

function goalNamesOf(playbook: string, rows: readonly ActivityRow[]) {
  return rows.some(({ goal }) => goal !== undefined)
    ? Effect.map(
        OrgReader.use((reader) => reader.namesHeldInPlaybook(playbook, goalType)),
        (held): ReadonlyMap<string, string> => new Map(held.map(({ definitionKey, name }) => [definitionKey, name])),
      )
    : Effect.succeed(noGoalNames);
}

function activityOf(reading: PlaybookActivityReading, playbook: string, asked: PlaybookActivityAsked) {
  return Effect.gen(function* () {
    const setAside = yield* reading.setAsideIn(playbook);
    const counts = yield* reading.countsIn(asked.viewer, playbook, new Map([[playbook, setAside]]));
    const paged = asked.page !== null && asked.paged.includes(playbook) ? asked.page : null;
    const rows = paged === null ? [] : yield* pageRowsOf(reading.tables, playbook, paged, setAside);
    const activity: ActivityOfAPlaybook = { setAside, counts, rows, goalNames: yield* goalNamesOf(playbook, rows) };
    return activity;
  });
}

export function playbookActivityKind(reading: PlaybookActivityReading): PlaybookActivityKind {
  return {
    name: reading.name,
    parentOf: (playbook) => playbook,
    key: Schema.String,
    asked: PlaybookActivityAskedSchema,
    value: ActivityOfAPlaybookSchema,
    read: (playbooks, asked) =>
      Effect.forEach(playbooks, (playbook) => activityOf(reading, playbook, asked), { concurrency: readsAtOnce }),
  };
}
