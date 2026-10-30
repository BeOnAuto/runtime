import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';

export interface Progress {
  readonly cursor: string | null;
  readonly delivered: string | null;
  readonly attempts: number;
  readonly waiting: boolean;
}

export interface FollowedPlaybook extends Progress {
  readonly playbookKey: string;
}

export interface FollowedPlaybooks {
  readonly follow: (playbookKey: string, cursor: string | null) => Effect.Effect<void>;
  readonly load: (playbookKey: string) => Effect.Effect<FollowedPlaybook | undefined>;
  readonly save: (playbookKey: string, progress: Progress) => Effect.Effect<void>;
  readonly waitingForASweep: (limit: number) => Effect.Effect<readonly FollowedPlaybook[]>;
  readonly following: (after: string, limit: number) => Effect.Effect<readonly FollowedPlaybook[]>;
}

const PlaybookRow = Schema.Struct({
  playbook_key: Schema.String,
  cursor: Schema.NullOr(Schema.String),
  delivered: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  waiting: WholeNumber,
});

function followedOf(row: typeof PlaybookRow.Type): FollowedPlaybook {
  return {
    playbookKey: row.playbook_key,
    cursor: row.cursor,
    delivered: row.delivered,
    attempts: row.attempts,
    waiting: row.waiting === 1,
  };
}

function loaded(database: HostDatabase, playbookKey: string): Effect.Effect<FollowedPlaybook | undefined> {
  return Effect.orDie(
    rowsOf(
      PlaybookRow,
      database.read(
        statement`SELECT playbook_key, cursor, delivered, attempts, waiting FROM workflow_followed_playbooks
          WHERE playbook_key = ${playbookKey}`,
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
            RETURNING playbook_key, cursor, delivered, attempts, waiting`,
        ),
      ),
    );
    return taken.map((row) => followedOf(row));
  });
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
    waitingForASweep: (limit) => waitingTakenFor(database, limit),
    following: (after, limit) =>
      Effect.orDie(
        rowsOf(
          PlaybookRow,
          database.read(
            statement`SELECT playbook_key, cursor, delivered, attempts, waiting FROM workflow_followed_playbooks
              WHERE playbook_key > ${after} ORDER BY playbook_key LIMIT ${limit}`,
          ),
        ),
      ).pipe(Effect.map((rows) => rows.map((row) => followedOf(row)))),
  };
}
