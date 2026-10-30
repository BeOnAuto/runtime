import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import type { HostClock } from '../loop/host-clock.ts';

const sweepsBeforeALeaseLapses = 3;

export const shortestLeaseMs = 3000;

const hostLeaseName = 'host';

export type LeaseClaim =
  | { readonly held: true }
  | { readonly held: false; readonly holder: string; readonly until: number };

export interface HostLease {
  readonly holder: string;
  readonly claimed: () => Effect.Effect<LeaseClaim, DatabaseFailed>;
  readonly released: () => Effect.Effect<void, DatabaseFailed>;
}

const HolderRow = Schema.Struct({ holder: Schema.String });

const LeaseRow = Schema.Struct({ holder: Schema.String, expires_at: WholeNumber });

export function leaseMsFor(sweepEveryMs: number): number {
  return Math.max(sweepsBeforeALeaseLapses * sweepEveryMs, shortestLeaseMs);
}

function currentHolderOf(database: HostDatabase): Effect.Effect<LeaseClaim, DatabaseFailed> {
  return oneRowOf(
    LeaseRow,
    database.read(statement`SELECT holder, expires_at FROM workflow_leases WHERE name = ${hostLeaseName}`),
  ).pipe(Effect.map(({ holder, expires_at: until }): LeaseClaim => ({ held: false, holder, until })));
}

function nowOn(database: HostDatabase, clock: HostClock): Effect.Effect<number, DatabaseFailed> {
  return database.sharedClock ?? Effect.sync(() => clock.now());
}

function claimAt(
  database: HostDatabase,
  holder: string,
  lastsMs: number,
  now: number,
): Effect.Effect<boolean, DatabaseFailed> {
  return rowsOf(
    HolderRow,
    database.write(
      statement`INSERT INTO workflow_leases (name, holder, expires_at) VALUES (${hostLeaseName}, ${holder}, ${now + lastsMs})
        ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
        WHERE workflow_leases.holder = excluded.holder OR workflow_leases.expires_at < ${now}
        RETURNING holder`,
    ),
  ).pipe(Effect.map((rows) => rows.length > 0));
}

export function hostLease(database: HostDatabase, holder: string, lastsMs: number, clock: HostClock): HostLease {
  return {
    holder,
    claimed: () =>
      nowOn(database, clock).pipe(
        Effect.flatMap((now) => claimAt(database, holder, lastsMs, now)),
        Effect.flatMap((held) => (held ? Effect.succeed<LeaseClaim>({ held: true }) : currentHolderOf(database))),
      ),
    released: () =>
      Effect.asVoid(
        database.write(statement`DELETE FROM workflow_leases WHERE name = ${hostLeaseName} AND holder = ${holder}`),
      ),
  };
}
