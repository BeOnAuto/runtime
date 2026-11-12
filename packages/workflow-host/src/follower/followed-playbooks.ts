import { statement } from '@on.auto/ledger';
import { mostTryAgainMs } from '@on.auto/operations/payloads';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';

export interface Progress {
  readonly cursor: string | null;
  readonly delivered: string | null;
  readonly attempts: number;
  readonly waiting: boolean;
}

export type HeldFor = 'content' | 'unreadable';

export interface Hold {
  readonly heldFor: string;
  readonly since: number;
  readonly until: number;
  readonly holds: number;
}

const mostUnreadableWaitMs = 5 * 60_000;

const mostWaitsMs: ReadonlyMap<string, number> = new Map<HeldFor, number>([
  ['content', mostTryAgainMs],
  ['unreadable', mostUnreadableWaitMs],
]);

const longestWaitMs = Math.max(...mostWaitsMs.values());

export function mostWaitOf(heldFor: string): number {
  return mostWaitsMs.get(heldFor) ?? longestWaitMs;
}

export function isDueAt({ heldFor, until }: Pick<Hold, 'heldFor' | 'until'>, now: number): boolean {
  return until <= now || until - now > mostWaitOf(heldFor);
}

export interface FollowedPlaybook extends Progress {
  readonly playbookKey: string;
  readonly hold: Hold | undefined;
}

export interface HeldPlaybook extends FollowedPlaybook {
  readonly hold: Hold;
}

export interface HeldPlaybooks {
  readonly due: readonly HeldPlaybook[];
  readonly nextAt: number | null;
}

export interface FollowedPlaybooks {
  readonly follow: (playbookKey: string, cursor: string | null) => Effect.Effect<void>;
  readonly load: (playbookKey: string) => Effect.Effect<FollowedPlaybook | undefined>;
  readonly save: (playbookKey: string, progress: Progress) => Effect.Effect<void>;
  readonly held: (playbookKey: string, hold: Hold) => Effect.Effect<void>;
  readonly lifted: (playbookKey: string) => Effect.Effect<void>;
  readonly heldAt: (now: number, limit: number) => Effect.Effect<HeldPlaybooks>;
  readonly waitingForASweep: (limit: number) => Effect.Effect<readonly FollowedPlaybook[]>;
  readonly following: (after: string, limit: number) => Effect.Effect<readonly FollowedPlaybook[]>;
}

const PlaybookRow = Schema.Struct({
  playbook_key: Schema.String,
  cursor: Schema.NullOr(Schema.String),
  delivered: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  waiting: WholeNumber,
  held_since: Schema.NullOr(WholeNumber),
  held_until: Schema.NullOr(WholeNumber),
  holds: WholeNumber,
  held_for: Schema.NullOr(Schema.String),
});

type ReadRow = typeof PlaybookRow.Type;

const HeldRow = Schema.Struct({
  ...PlaybookRow.fields,
  held_since: WholeNumber,
  held_until: WholeNumber,
  held_for: Schema.String,
});

type HeldRead = typeof HeldRow.Type;

function heldPlaybookOf(row: HeldRead): HeldPlaybook {
  const { held_for: heldFor, held_since: since, held_until: until, holds } = row;
  return { ...followedOf(row), hold: { heldFor, since, until, holds } };
}

function isDueRow({ held_for: heldFor, held_until: until }: HeldRead, now: number): boolean {
  return isDueAt({ heldFor, until }, now);
}

function holdOf({ held_for: heldFor, held_since: since, held_until: until, holds }: ReadRow): Hold | undefined {
  return heldFor === null || since === null || until === null ? undefined : { heldFor, since, until, holds };
}

function followedOf(row: ReadRow): FollowedPlaybook {
  return {
    playbookKey: row.playbook_key,
    cursor: row.cursor,
    delivered: row.delivered,
    attempts: row.attempts,
    waiting: row.waiting === 1,
    hold: holdOf(row),
  };
}

function loaded(database: HostDatabase, playbookKey: string): Effect.Effect<FollowedPlaybook | undefined> {
  return Effect.orDie(
    rowsOf(
      PlaybookRow,
      database.read(
        statement`SELECT playbook_key, cursor, delivered, attempts, waiting, held_since, held_until, holds, held_for
          FROM workflow_followed_playbooks WHERE playbook_key = ${playbookKey}`,
      ),
    ),
  ).pipe(Effect.map(([row]) => (row === undefined ? undefined : followedOf(row))));
}

function waitingTakenFor(database: HostDatabase, limit: number): Effect.Effect<readonly FollowedPlaybook[]> {
  return Effect.gen(function* () {
    const waiting = yield* Effect.orDie(
      database.read(
        statement`SELECT playbook_key FROM workflow_followed_playbooks WHERE waiting = 1 ORDER BY checked, playbook_key LIMIT ${limit}`,
      ),
    );
    if (waiting.length === 0) {
      return [];
    }
    const taken = yield* Effect.orDie(
      rowsOf(
        PlaybookRow,
        database.write(
          statement`UPDATE workflow_followed_playbooks
            SET checked = (SELECT COALESCE(MAX(checked), 0) + 1 FROM workflow_followed_playbooks WHERE waiting = 1)
            WHERE playbook_key IN (
              SELECT playbook_key FROM workflow_followed_playbooks WHERE waiting = 1 ORDER BY checked, playbook_key LIMIT ${limit}
            )
            RETURNING playbook_key, cursor, delivered, attempts, waiting, held_since, held_until, holds, held_for`,
        ),
      ),
    );
    return taken.map((row) => followedOf(row));
  });
}

function heldOn(database: HostDatabase, playbookKey: string, hold: Hold | null): Effect.Effect<void> {
  const { heldFor = null, since = null, until = null, holds = 0 } = hold ?? {};
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_followed_playbooks
          SET held_since = ${since}, held_until = ${until}, holds = ${holds}, held_for = ${heldFor}
          WHERE playbook_key = ${playbookKey}`,
      ),
    ),
  );
}

function heldPlaybooksAt(database: HostDatabase, now: number, limit: number): Effect.Effect<HeldPlaybooks> {
  return Effect.orDie(
    rowsOf(
      HeldRow,
      database.read(
        statement`SELECT playbook_key, cursor, delivered, attempts, waiting, held_since, held_until, holds, held_for
          FROM workflow_followed_playbooks
          WHERE held_until IS NOT NULL AND held_since IS NOT NULL AND held_for IS NOT NULL
          ORDER BY held_until, playbook_key LIMIT ${limit}`,
      ),
    ),
  ).pipe(
    Effect.map((rows) => {
      const due = rows.filter((row) => isDueRow(row, now));
      const next = rows.find((row) => !isDueRow(row, now));
      return { due: due.map((row) => heldPlaybookOf(row)), nextAt: next?.held_until ?? null };
    }),
  );
}

export function followedPlaybooksOn(database: HostDatabase): FollowedPlaybooks {
  return {
    follow: (playbookKey, cursor) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(
            statement`INSERT INTO workflow_followed_playbooks (playbook_key, cursor) VALUES (${playbookKey}, ${cursor})
              ON CONFLICT (playbook_key) DO NOTHING`,
          ),
        ),
      ),
    load: (playbookKey) => loaded(database, playbookKey),
    save: (playbookKey, { cursor, delivered, attempts, waiting }) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(
            statement`UPDATE workflow_followed_playbooks
              SET cursor = ${cursor}, delivered = ${delivered}, attempts = ${attempts}, waiting = ${waiting ? 1 : 0}
              WHERE playbook_key = ${playbookKey}`,
          ),
        ),
      ),
    held: (playbookKey, hold) => heldOn(database, playbookKey, hold),
    lifted: (playbookKey) => heldOn(database, playbookKey, null),
    heldAt: (now, limit) => heldPlaybooksAt(database, now, limit),
    waitingForASweep: (limit) => waitingTakenFor(database, limit),
    following: (after, limit) =>
      Effect.orDie(
        rowsOf(
          PlaybookRow,
          database.read(
            statement`SELECT playbook_key, cursor, delivered, attempts, waiting, held_since, held_until, holds, held_for
              FROM workflow_followed_playbooks WHERE playbook_key > ${after} ORDER BY playbook_key LIMIT ${limit}`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map((row) => followedOf(row)))),
  };
}
