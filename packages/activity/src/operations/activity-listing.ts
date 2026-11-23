import { Caller, NotFound, type OrgReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { activityOfReadablePlaybooks, pageOfPlaybooks, setAsideOfThe } from '../entities/activity-of-playbooks.ts';
import type { ActivityOfAPlaybook, PlaybookActivityKind, SetAsideOfAPlaybook } from '../entities/playbook-activity.ts';
import type { CountedActivity } from './activity-counts.ts';
import { kindsOf, positionAt, type DismissedAsked, type ListActivityInput } from './activity-input.ts';
import { pageOf } from './activity-page.ts';
import type { ActivityKind, ActivityRow } from './activity-row.ts';
import { throughOf, viewerOf, type Viewer } from './activity-viewer.ts';
import { loadPlaybookRegister, type PlaybookRegister } from './playbook-register.ts';

function playbookAsked(register: PlaybookRegister, playbook: string | undefined) {
  return playbook === undefined || register.known.has(playbook)
    ? Effect.succeed(playbook)
    : Effect.fail(new NotFound({ detail: `There is no playbook ${playbook} in this org` }));
}

function pagedIn(playbook: string | undefined): (readable: readonly string[]) => readonly string[] {
  return (readable) => (playbook === undefined ? readable : readable.filter((each) => each === playbook));
}

export interface ActivityServing<Row, Counts, R> {
  readonly kinds: readonly ActivityKind[];
  readonly playbooks: PlaybookActivityKind;
  readonly rowsServed: (
    rows: readonly ActivityRow[],
    viewer: Viewer,
    shown: ReadonlyMap<string, SetAsideOfAPlaybook>,
    ofPlaybooks: readonly ActivityOfAPlaybook[],
  ) => Effect.Effect<readonly Row[], never, R>;
  readonly countsOf: (counted: CountedActivity) => Effect.Effect<Counts, never, OrgReader>;
}

export function listedBy<Row, Counts, R>({
  kinds: known,
  playbooks,
  rowsServed,
  countsOf,
}: ActivityServing<Row, Counts, R>) {
  return Effect.fnUntraced(function* (input: ListActivityInput & DismissedAsked) {
    const caller = yield* Caller;
    const register = yield* loadPlaybookRegister;
    const playbook = yield* playbookAsked(register, input.playbook);
    const kinds = yield* kindsOf(input.kind, known);
    const since = yield* positionAt('since', input.since, register);
    const cursor = yield* positionAt('cursor', input.cursor, register);
    const viewer = yield* viewerOf(caller.id);
    const withTheOrg = caller.playbooks === '*';
    const page = pageOfPlaybooks(input, kinds, caller.id)(cursor, since);
    const pagedOf = pagedIn(playbook);
    const { readable, ofPlaybooks } = yield* activityOfReadablePlaybooks(playbooks, register.active, {
      viewer,
      page,
      pagedOf,
    });
    const paged = pagedOf(readable);
    const setAside = setAsideOfThe(readable, ofPlaybooks, page.dismissed);
    const listed = yield* pageOf(
      register,
      {
        kinds,
        playbooks: paged,
        withTheOrg: withTheOrg && playbook === undefined,
        mine: page.mine ?? undefined,
        limit: page.limit,
        cursor,
        since,
        leftOut: setAside.leftOut,
      },
      ofPlaybooks,
    );
    return {
      rows: yield* rowsServed(listed.rows, viewer, setAside.shown, ofPlaybooks),
      has_more: listed.hasMore,
      next_cursor: listed.nextCursor,
      counts: yield* countsOf({ viewer, readable, withTheOrg, changes: register.changes, ofPlaybooks }),
      through: throughOf(viewer.seen),
    };
  });
}

export const activityStaleOn = [
  { kind: 'playbook' },
  { kind: 'definition' },
  { kind: 'run' },
  { kind: 'interaction' },
  { kind: 'goal' },
  { kind: 'comment' },
] as const;
