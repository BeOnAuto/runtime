import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { DueItem, DueWork } from '../due-work/due-work.ts';
import { runKeyOf, type RunAddress } from '../runs/run-address.ts';
import {
  attemptLeasePrefix,
  clockOf,
  leasedAttemptOf,
  leasesOfTheRun,
  tokenAfter,
  type AttemptLeaseSettings,
  type LeasedAttempt,
} from './attempt-leases.ts';
import { nowOn } from './host-lease.ts';

export type HolderGoneReceipt = 'ended' | 'not_running' | 'outlives_its_call';

export interface GoneHolders {
  readonly holdingOf: (run: RunAddress) => Effect.Effect<number | undefined>;
  readonly ended: (run: RunAddress, fencingToken: number) => Effect.Effect<HolderGoneReceipt>;
  readonly resumed: (run: RunAddress) => Effect.Effect<void>;
}

const LeaseRow = Schema.Struct({ name: Schema.String, holder: Schema.String, expires_at: WholeNumber });

type LapsedLease = typeof LeaseRow.Type;

const NameRow = Schema.Struct({ name: Schema.String });

const SoonestRow = Schema.Struct({ soonest: Schema.NullOr(WholeNumber) });

const nothingDue: readonly DueItem[] = [];

const leaseNames = `${attemptLeasePrefix}%`;

function lapsedRows(database: HostDatabase, holder: string, now: number, most: number) {
  return rowsOf(
    LeaseRow,
    database.read(
      statement`SELECT name, holder, expires_at FROM workflow_leases
        WHERE name LIKE ${leaseNames} AND holder <> ${holder} AND expires_at < ${now}
        ORDER BY expires_at, name LIMIT ${most}`,
    ),
  );
}

function soonestLapseAfter(database: HostDatabase, holder: string, after: number) {
  return Effect.map(
    oneRowOf(
      SoonestRow,
      database.read(
        statement`SELECT MIN(expires_at) AS soonest FROM workflow_leases
          WHERE name LIKE ${leaseNames} AND holder <> ${holder} AND expires_at > ${after}`,
      ),
    ),
    ({ soonest }) => soonest,
  );
}

function tokensOfLiveLeasesBeside(
  database: HostDatabase,
  { name }: LapsedLease,
  { run }: LeasedAttempt,
  now: number,
): Effect.Effect<readonly (number | undefined)[], DatabaseFailed> {
  const ofTheRun = leasesOfTheRun(runKeyOf(run));
  return Effect.map(
    rowsOf(
      NameRow,
      database.read(
        statement`SELECT name FROM workflow_leases
          WHERE substr(name, 1, ${ofTheRun.length}) = ${ofTheRun} AND name <> ${name} AND expires_at >= ${now}`,
      ),
    ),
    (rows) => rows.map((row) => tokenAfter(row.name, ofTheRun)),
  );
}

function forgotten(database: HostDatabase, { name, holder, expires_at: expiresAt }: LapsedLease) {
  return Effect.asVoid(
    database.write(
      statement`DELETE FROM workflow_leases WHERE name = ${name} AND holder = ${holder} AND expires_at = ${expiresAt}`,
    ),
  );
}

interface Judging {
  readonly database: HostDatabase;
  readonly settings: AttemptLeaseSettings;
  readonly gone: GoneHolders;
}

function endedAs(judging: Judging, row: LapsedLease, run: RunAddress, fencingToken: number) {
  const { gone, database } = judging;
  return Effect.flatMap(gone.ended(run, fencingToken), (receipt) =>
    Effect.andThen(receipt === 'outlives_its_call' ? gone.resumed(run) : Effect.void, forgotten(database, row)),
  );
}

type HeldBeside = 'held_by_another' | 'perhaps_held_by_another' | 'held_by_none';

function heldBeside(tokens: readonly (number | undefined)[], holding: number): HeldBeside {
  if (tokens.includes(holding)) {
    return 'held_by_another';
  }
  return tokens.includes(undefined) ? 'perhaps_held_by_another' : 'held_by_none';
}

interface Holding {
  readonly run: RunAddress;
  readonly fencingToken: number;
  readonly beside: HeldBeside;
}

function judgedBeside(judging: Judging, row: LapsedLease, { run, fencingToken, beside }: Holding) {
  if (beside === 'perhaps_held_by_another') {
    return Effect.void;
  }
  return beside === 'held_by_another' ? forgotten(judging.database, row) : endedAs(judging, row, run, fencingToken);
}

function tokenlessEnded(
  judging: Judging,
  row: LapsedLease,
  leased: LeasedAttempt,
): Effect.Effect<void, DatabaseFailed> {
  const { database, settings, gone } = judging;
  return Effect.gen(function* () {
    const holding = yield* gone.holdingOf(leased.run);
    if (holding === undefined) {
      return yield* forgotten(database, row);
    }
    const now = yield* nowOn(database, clockOf(settings));
    const tokens = yield* tokensOfLiveLeasesBeside(database, row, leased, now);
    return yield* judgedBeside(judging, row, {
      run: leased.run,
      fencingToken: holding,
      beside: heldBeside(tokens, holding),
    });
  });
}

function judged(judging: Judging, row: LapsedLease): Effect.Effect<void, DatabaseFailed> {
  const leased = leasedAttemptOf(row.name);
  return leased.fencingToken === undefined
    ? tokenlessEnded(judging, row, leased)
    : endedAs(judging, row, leased.run, leased.fencingToken);
}

export function goneHoldersWork(database: HostDatabase, settings: AttemptLeaseSettings, gone: GoneHolders): DueWork {
  const judging: Judging = { database, settings, gone };
  const { holder } = settings;
  const clock = clockOf(settings);
  const due = (most: number) =>
    Effect.flatMap(nowOn(database, clock), (now) =>
      Effect.map(lapsedRows(database, holder, now, most), (rows) =>
        rows.map((row): DueItem => ({ key: row.name, callsOut: false, perform: () => judged(judging, row) })),
      ),
    );
  return {
    name: 'attempts whose holder is gone',
    due: (_now, most, callsOut) => (callsOut ? Effect.succeed(nothingDue) : due(most)),
    nextDueAt: (after, callsOut = false) =>
      callsOut ? Effect.succeed(null) : soonestLapseAfter(database, holder, after),
  };
}
