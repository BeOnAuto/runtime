import { statement } from '@on.auto/ledger';
import { mostTryAgainMs } from '@on.auto/operations/payloads';
import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';

export interface Progress {
  readonly cursor: string | null;
  readonly delivered: string | null;
  readonly attempts: number;
  readonly waiting: boolean;
}

export type HeldAtTheRecordFor = 'content' | 'unreadable';

export type HeldFor = HeldAtTheRecordFor | 'delivery';

const parkedForADelivery: HeldFor = 'delivery';

export interface Hold {
  readonly heldFor: string;
  readonly since: number;
  readonly until: number;
  readonly holds: number;
}

const mostUnreadableWaitMs = 5 * 60_000;

const mostWaitsMs: ReadonlyMap<string, number> = new Map<HeldAtTheRecordFor, number>([
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

export interface FollowedOrg extends Progress {
  readonly org: string;
}

export interface ParkedPlaybook {
  readonly playbookKey: string;
  readonly org: string;
  readonly progress: Progress;
  readonly hold: Hold;
}

export interface HeldPlaybook extends ParkedPlaybook {
  readonly progress: Progress & { readonly cursor: string };
}

export interface HeldPlaybooks {
  readonly due: readonly HeldPlaybook[];
  readonly nextAt: number | null;
}

export interface FollowedOrgs {
  readonly follow: (org: string, cursor: string) => Effect.Effect<void>;
  readonly load: (org: string) => Effect.Effect<FollowedOrg | undefined>;
  readonly save: (org: string, progress: Progress) => Effect.Effect<void>;
  readonly waitingForASweep: (limit: number) => Effect.Effect<readonly FollowedOrg[]>;
  readonly following: (after: string, limit: number) => Effect.Effect<readonly FollowedOrg[]>;
  readonly heldIn: (org: string) => Effect.Effect<ReadonlySet<string>>;
  readonly parked: (parked: ParkedPlaybook) => Effect.Effect<void>;
  readonly held: (playbookKey: string, hold: Hold) => Effect.Effect<void>;
  readonly lifted: (playbookKey: string) => Effect.Effect<void>;
  readonly heldAt: (now: number, limit: number) => Effect.Effect<HeldPlaybooks>;
  readonly parkedForDelivery: (limit: number) => Effect.Effect<readonly HeldPlaybook[]>;
}

const OrgRow = Schema.Struct({
  org: Schema.String,
  cursor: Schema.NullOr(Schema.String),
  delivered: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  waiting: WholeNumber,
});

const HeldRow = Schema.Struct({
  playbook_key: Schema.String,
  org: Schema.String,
  cursor: Schema.String,
  delivered: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  held_since: WholeNumber,
  held_until: WholeNumber,
  holds: WholeNumber,
  held_for: Schema.String,
});

const PlaybookRow = Schema.Struct({ playbook_key: Schema.String });

type HeldRead = typeof HeldRow.Type;

function followedOf(row: typeof OrgRow.Type): FollowedOrg {
  return {
    org: row.org,
    cursor: row.cursor,
    delivered: row.delivered,
    attempts: row.attempts,
    waiting: row.waiting === 1,
  };
}

function heldPlaybookOf(row: HeldRead): HeldPlaybook {
  const { held_for: heldFor, held_since: since, held_until: until, holds } = row;
  return {
    playbookKey: row.playbook_key,
    org: row.org,
    progress: { cursor: row.cursor, delivered: row.delivered, attempts: row.attempts, waiting: false },
    hold: { heldFor, since, until, holds },
  };
}

function isDueRow({ held_for: heldFor, held_until: until }: HeldRead, now: number): boolean {
  return isDueAt({ heldFor, until }, now);
}

function orgsRead(rows: Effect.Effect<readonly unknown[], DatabaseFailed>): Effect.Effect<readonly FollowedOrg[]> {
  return Effect.orDie(rowsOf(OrgRow, rows)).pipe(Effect.map((read) => read.map((row) => followedOf(row))));
}

function waitingTakenFor(database: HostDatabase, limit: number): Effect.Effect<readonly FollowedOrg[]> {
  return Effect.gen(function* () {
    const waiting = yield* Effect.orDie(
      database.read(
        statement`SELECT org FROM workflow_followed_orgs WHERE waiting = 1 ORDER BY checked, org LIMIT ${limit}`,
      ),
    );
    if (waiting.length === 0) {
      return [];
    }
    return yield* orgsRead(
      database.write(
        statement`UPDATE workflow_followed_orgs
          SET checked = (SELECT COALESCE(MAX(checked), 0) + 1 FROM workflow_followed_orgs WHERE waiting = 1)
          WHERE org IN (SELECT org FROM workflow_followed_orgs WHERE waiting = 1 ORDER BY checked, org LIMIT ${limit})
          RETURNING org, cursor, delivered, attempts, waiting`,
      ),
    );
  });
}

function heldPlaybooksAt(database: HostDatabase, now: number, limit: number): Effect.Effect<HeldPlaybooks> {
  return Effect.orDie(
    rowsOf(
      HeldRow,
      database.read(
        statement`SELECT playbook_key, org, cursor, delivered, attempts, held_since, held_until, holds, held_for
          FROM workflow_held_playbooks WHERE held_for <> ${parkedForADelivery}
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

function parkedForDeliveryOn(database: HostDatabase, limit: number): Effect.Effect<readonly HeldPlaybook[]> {
  return Effect.orDie(
    rowsOf(
      HeldRow,
      database.read(
        statement`SELECT playbook_key, org, cursor, delivered, attempts, held_since, held_until, holds, held_for
          FROM workflow_held_playbooks WHERE held_for = ${parkedForADelivery}
          ORDER BY held_until, playbook_key LIMIT ${limit}`,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.map((row) => heldPlaybookOf(row))));
}

function parkedOn(database: HostDatabase, { playbookKey, org, progress, hold }: ParkedPlaybook): Effect.Effect<void> {
  const { cursor, delivered, attempts } = progress;
  const { heldFor, since, until, holds } = hold;
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`INSERT INTO workflow_held_playbooks
            (playbook_key, org, cursor, delivered, attempts, held_since, held_until, holds, held_for)
          VALUES (${playbookKey}, ${org}, ${cursor}, ${delivered}, ${attempts}, ${since}, ${until}, ${holds}, ${heldFor})
          ON CONFLICT (playbook_key) DO UPDATE SET
            cursor = excluded.cursor, delivered = excluded.delivered, attempts = excluded.attempts,
            held_since = excluded.held_since, held_until = excluded.held_until, holds = excluded.holds,
            held_for = excluded.held_for`,
      ),
    ),
  );
}

function followedOn(database: HostDatabase, org: string, cursor: string): Effect.Effect<void> {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`INSERT INTO workflow_followed_orgs (org, cursor) VALUES (${org}, ${cursor})
          ON CONFLICT (org) DO NOTHING`,
      ),
    ),
  );
}

function savedOn(database: HostDatabase, org: string, progress: Progress): Effect.Effect<void> {
  const { cursor, delivered, attempts, waiting } = progress;
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_followed_orgs
          SET cursor = ${cursor}, delivered = ${delivered}, attempts = ${attempts}, waiting = ${waiting ? 1 : 0}
          WHERE org = ${org}`,
      ),
    ),
  );
}

function heldOn(database: HostDatabase, playbookKey: string, { heldFor, since, until, holds }: Hold) {
  return Effect.asVoid(
    Effect.orDie(
      database.write(
        statement`UPDATE workflow_held_playbooks
          SET held_since = ${since}, held_until = ${until}, holds = ${holds}, held_for = ${heldFor}
          WHERE playbook_key = ${playbookKey}`,
      ),
    ),
  );
}

function heldInOn(database: HostDatabase, org: string): Effect.Effect<ReadonlySet<string>> {
  return Effect.orDie(
    rowsOf(PlaybookRow, database.read(statement`SELECT playbook_key FROM workflow_held_playbooks WHERE org = ${org}`)),
  ).pipe(Effect.map((rows) => new Set(rows.map(({ playbook_key: playbookKey }) => playbookKey))));
}

export function followedOrgsOn(database: HostDatabase): FollowedOrgs {
  return {
    follow: (org, cursor) => followedOn(database, org, cursor),
    load: (org) =>
      Effect.map(
        orgsRead(
          database.read(
            statement`SELECT org, cursor, delivered, attempts, waiting FROM workflow_followed_orgs WHERE org = ${org}`,
          ),
        ),
        ([followed]) => followed,
      ),
    save: (org, progress) => savedOn(database, org, progress),
    waitingForASweep: (limit) => waitingTakenFor(database, limit),
    following: (after, limit) =>
      orgsRead(
        database.read(
          statement`SELECT org, cursor, delivered, attempts, waiting
            FROM workflow_followed_orgs WHERE org > ${after} ORDER BY org LIMIT ${limit}`,
        ),
      ),
    heldIn: (org) => heldInOn(database, org),
    parked: (parked) => parkedOn(database, parked),
    held: (playbookKey, hold) => heldOn(database, playbookKey, hold),
    lifted: (playbookKey) =>
      Effect.asVoid(
        Effect.orDie(
          database.write(statement`DELETE FROM workflow_held_playbooks WHERE playbook_key = ${playbookKey}`),
        ),
      ),
    heldAt: (now, limit) => heldPlaybooksAt(database, now, limit),
    parkedForDelivery: (limit) => parkedForDeliveryOn(database, limit),
  };
}
