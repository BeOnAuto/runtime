import { attemptKeyOf } from '@on.auto/definitions/attempts';
import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Effect } from 'effect';

import { hostDatabaseOn, type DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { systemClock, type HostClock } from '../loop/host-clock.ts';
import type { RunInAPlaybook } from '../runs/run-address.ts';
import { nowOn } from './host-lease.ts';

const sweepsBeforeAnAttemptLeaseLapses = 3;

const shortestAttemptLeaseMs = 30_000;

export const attemptLeasePrefix = 'attempt/';

const noHolder = '';

export function attemptLeaseMsFor(sweepEveryMs: number): number {
  return Math.max(sweepsBeforeAnAttemptLeaseLapses * sweepEveryMs, shortestAttemptLeaseMs);
}

export interface AttemptLeaseSettings {
  readonly holder: string;
  readonly sweepEveryMs: number;
  readonly clock?: HostClock;
}

export function clockOf({ clock = systemClock }: AttemptLeaseSettings): HostClock {
  return clock;
}

export interface AttemptLeases {
  readonly taken: (runKey: string) => Effect.Effect<void, DatabaseFailed>;
  readonly named: (runKey: string, fencingToken: number) => Effect.Effect<void, DatabaseFailed>;
  readonly released: (runKey: string) => Effect.Effect<void, DatabaseFailed>;
  readonly handedOver: (runKey: string) => Effect.Effect<void, DatabaseFailed>;
}

export interface LeasedAttempt {
  readonly run: RunInAPlaybook;
  readonly fencingToken: number | undefined;
}

export function leasesOfTheRun(runKey: string): string {
  return `${attemptLeasePrefix}${runKey}/`;
}

function tokenlessName(runKey: string, holder: string): string {
  return `${leasesOfTheRun(runKey)}${holder}`;
}

const holderAndToken = /^[^/]+\/(\d+)$/u;

export function tokenAfter(name: string, ofTheRun: string): number | undefined {
  const named = holderAndToken.exec(name.slice(ofTheRun.length));
  return named === null ? undefined : Number(named[1]);
}

export function attemptKeyOfRun({ org, playbook, runId }: RunInAPlaybook): string {
  return attemptKeyOf({ org, playbook }, runId);
}

export function leasedAttemptOf(name: string): LeasedAttempt {
  const [org = '', playbook = '', runId = ''] = name.slice(attemptLeasePrefix.length).split('/');
  const run = { org, playbook, runId };
  return { run, fencingToken: tokenAfter(name, leasesOfTheRun(attemptKeyOfRun(run))) };
}

export function attemptLeasesRenewed(
  database: HostDatabase,
  settings: AttemptLeaseSettings,
): Effect.Effect<void, DatabaseFailed> {
  const { holder, sweepEveryMs } = settings;
  const lastsMs = attemptLeaseMsFor(sweepEveryMs);
  return Effect.flatMap(nowOn(database, clockOf(settings)), (now) =>
    Effect.asVoid(
      database.write(
        statement`UPDATE workflow_leases SET expires_at = ${now + lastsMs}
          WHERE holder = ${holder} AND name LIKE ${`${attemptLeasePrefix}%`}`,
      ),
    ),
  );
}

function leaseTaken(database: HostDatabase, settings: AttemptLeaseSettings, name: string) {
  const { holder, sweepEveryMs } = settings;
  return Effect.flatMap(nowOn(database, clockOf(settings)), (now) =>
    Effect.asVoid(
      database.write(
        statement`INSERT INTO workflow_leases (name, holder, expires_at)
          VALUES (${name}, ${holder}, ${now + attemptLeaseMsFor(sweepEveryMs)})
          ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at`,
      ),
    ),
  );
}

function leaseNamed(database: HostDatabase, holder: string, before: string, name: string) {
  return Effect.asVoid(
    database.transaction([
      statement`DELETE FROM workflow_leases WHERE name = ${name} AND holder = ${noHolder}`,
      statement`UPDATE workflow_leases SET name = ${name} WHERE name = ${before} AND holder = ${holder}`,
    ]),
  );
}

export function attemptLeasesOn(database: HostDatabase, settings: AttemptLeaseSettings): AttemptLeases {
  const { holder } = settings;
  const held = new Map<string, string>();
  const letGo = (runKey: string) => {
    const name = held.get(runKey) ?? tokenlessName(runKey, holder);
    held.delete(runKey);
    return name;
  };
  return {
    taken: (runKey) =>
      Effect.suspend(() => {
        const name = tokenlessName(runKey, holder);
        held.set(runKey, name);
        return leaseTaken(database, settings, name);
      }),
    named: (runKey, fencingToken) =>
      Effect.suspend(() => {
        const before = held.get(runKey);
        if (before === undefined) {
          return Effect.void;
        }
        const name = `${tokenlessName(runKey, holder)}/${fencingToken}`;
        held.set(runKey, name);
        return leaseNamed(database, holder, before, name);
      }),
    released: (runKey) =>
      Effect.suspend(() =>
        Effect.asVoid(
          database.write(statement`DELETE FROM workflow_leases WHERE name = ${letGo(runKey)} AND holder = ${holder}`),
        ),
      ),
    handedOver: (runKey) =>
      Effect.suspend(() =>
        Effect.asVoid(
          database.write(
            statement`UPDATE workflow_leases SET holder = ${noHolder}, expires_at = 0
              WHERE name = ${letGo(runKey)} AND holder = ${holder}`,
          ),
        ),
      ),
  };
}

export function attemptLeasesOver(connection: ConnectionPorts, settings: AttemptLeaseSettings): AttemptLeases {
  return attemptLeasesOn(hostDatabaseOn(connection), settings);
}
