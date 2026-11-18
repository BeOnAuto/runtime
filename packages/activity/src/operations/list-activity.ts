import {
  Caller,
  NotFound,
  PlaybookIdSchema,
  canAccessPlaybook,
  defineHttpOperation,
  type OrgReader,
} from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import {
  countsFor,
  noneSetAsideOf,
  type ActivityCounts,
  type CountedActivity,
  type SetAsideOf,
} from './activity-counts.ts';
import { cursorField, kindsOf, mostRowsInAPage, positionAt, rowsInAPage } from './activity-input.ts';
import { pageOf } from './activity-page.ts';
import {
  ActivityRowSchema,
  activityKinds,
  seenKinds,
  servedRow,
  type ActivityKind,
  type ActivityRow,
  type ServedActivityRow,
} from './activity-row.ts';
import { activityTables, type ActivityTable } from './activity-tables.ts';
import { isSeenBy, throughOf, viewerOf, type Viewer } from './activity-viewer.ts';
import { noneSetAside, type RequestsSetAside } from './needs-you.ts';
import { loadPlaybookRegister, mostPlaybookChanges, type PlaybookRegister } from './playbook-register.ts';

export const ActivityCountsSchema = Schema.Struct({
  needs_you: Schema.Int.annotate({ description: 'The requests that wait on the caller' }),
  broken: Schema.Int.annotate({ description: 'The broken definitions' }),
  new: Schema.Int.annotate({ description: 'The new rows the caller has not seen' }),
  comments: Schema.Int.annotate({
    description: 'The open comments others made or reopened that the caller has not seen',
  }),
}).annotate({ description: 'What the caller has to look at, over every playbook the caller may access' });

export const ThroughSchema = Schema.NullOr(
  Schema.Struct({
    cursor: Schema.String.annotate({ description: 'The cursor the caller marked everything seen through' }),
    seen_at: Schema.String.annotate({ description: 'When the caller marked it, in ISO 8601 UTC' }),
  }),
).annotate({ description: 'Where the caller marked everything seen, or null before they first did' });

export const ListActivityInputSchema = Schema.Struct({
  kind: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'One kind, needs_you, broken, new or comment, or several separated by commas: keep the rows of those kinds',
    }),
  ),
  playbook: Schema.optionalKey(PlaybookIdSchema.annotate({ description: 'Keep the rows of one playbook' })),
  mine: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true keeps, of the new and comment rows, those whose by is the caller, and leaves the other kinds as they are',
    }),
  ),
  since: Schema.optionalKey(cursorField('A cursor: keep the rows after the row it names')),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: mostRowsInAPage })).annotate({
      description: `How many rows a page holds, 1 to ${mostRowsInAPage}; ${rowsInAPage} when left out`,
    }),
  ),
  cursor: Schema.optionalKey(cursorField('The next_cursor of the page before')),
});

export type ListActivityInput = typeof ListActivityInputSchema.Type;

interface DismissedAsked {
  readonly dismissed?: 'include';
}

const ListActivityOutputSchema = Schema.Struct({
  rows: Schema.Array(ActivityRowSchema).annotate({ description: 'The rows of the page, newest first by at' }),
  has_more: Schema.Boolean.annotate({ description: 'Whether more rows follow this page' }),
  next_cursor: Schema.NullOr(Schema.String).annotate({
    description: 'The cursor to pass as cursor for the next page, or null after the last',
  }),
  counts: ActivityCountsSchema,
  through: ThroughSchema,
});

function playbookAsked(register: PlaybookRegister, playbook: string | undefined) {
  return playbook === undefined || register.known.has(playbook)
    ? Effect.succeed(playbook)
    : Effect.fail(new NotFound({ detail: `There is no playbook ${playbook} in this org` }));
}

export interface ActivityServing<Row, Counts, R> {
  readonly kinds: readonly ActivityKind[];
  readonly tables: readonly ActivityTable[];
  readonly rowsServed: (
    rows: readonly ActivityRow[],
    viewer: Viewer,
    shown: RequestsSetAside,
  ) => Effect.Effect<readonly Row[], never, R>;
  readonly countsOf: (counted: CountedActivity) => Effect.Effect<Counts, never, OrgReader>;
  readonly setAsideOf: SetAsideOf;
}

export function listedBy<Row, Counts, R>({
  kinds: known,
  tables,
  rowsServed,
  countsOf,
  setAsideOf,
}: ActivityServing<Row, Counts, R>) {
  return Effect.fnUntraced(function* (input: ListActivityInput & DismissedAsked) {
    const caller = yield* Caller;
    const register = yield* loadPlaybookRegister;
    const playbook = yield* playbookAsked(register, input.playbook);
    const kinds = yield* kindsOf(input.kind, known);
    const since = yield* positionAt('since', input.since, register);
    const cursor = yield* positionAt('cursor', input.cursor, register);
    const readable = [...register.active].filter((each) => canAccessPlaybook(caller.playbooks, each)).toSorted();
    const viewer = yield* viewerOf(caller.id);
    const withTheOrg = caller.playbooks === '*';
    const setAside = yield* setAsideOf(readable);
    const included = input.dismissed === 'include';
    const shown = included ? setAside : noneSetAside;
    const page = yield* pageOf(
      register,
      {
        kinds,
        playbooks: playbook === undefined ? readable : readable.filter((each) => each === playbook),
        withTheOrg: withTheOrg && playbook === undefined,
        mine: input.mine === true ? caller.id : undefined,
        limit: input.limit ?? rowsInAPage,
        cursor,
        since,
        leftOut: included ? noneSetAside : setAside,
      },
      tables,
    );
    return {
      rows: yield* rowsServed(page.rows, viewer, shown),
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
      counts: yield* countsOf({ viewer, readable, withTheOrg, changes: register.changes, setAside }),
      through: throughOf(viewer.seen),
    };
  });
}

const servedToday: ActivityServing<ServedActivityRow, ActivityCounts, never> = {
  kinds: activityKinds,
  tables: activityTables,
  rowsServed: (rows, viewer) =>
    Effect.succeed(rows.map((row) => servedRow(row, seenKinds.has(row.kind) ? isSeenBy(viewer, row) : null))),
  countsOf: countsFor,
  setAsideOf: noneSetAsideOf,
};

export const listActivity = defineHttpOperation('org', 'query', {
  name: 'list_activity',
  title: 'List activity',
  description: [
    'Lists the activity of the playbooks of the org the caller may access, newest first:',
    'the requests that wait on an answer, the definitions whose latest run broke,',
    `the runs, definitions and playbooks that are new, the playbooks from the newest ${mostPlaybookChanges} changes of the org's register,`,
    "and the open comments people made on them and, for a caller who may access every playbook, on the organization's own things.",
    'Each new and comment row says whether the caller has seen it, and the answer counts what waits on the caller and where they marked everything seen.',
  ].join(' '),
  route: { method: 'GET', path: '/activity' },
  permittedBy: ['org:read', 'playbook:read'],
  body: { kind: 'none' },
  inputSchema: ListActivityInputSchema,
  outputSchema: ListActivityOutputSchema,
  reasons: ['invalid_input', 'not_found'],
  handle: listedBy(servedToday),
});
