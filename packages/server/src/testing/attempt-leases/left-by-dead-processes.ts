import type { RunEvent } from '@on.auto/definitions';
import { recordedAsGiven } from '@on.auto/definitions/testing';
import { LedgerConnection, statement } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { HostRuntime, StartingWork } from '../../workflows/host-dependencies.ts';
import { inRuntime } from '../../workflows/in-runtime.ts';

export const now = Date.parse('2026-11-15T09:00:00.000Z');

export const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const runKey = `acme/alpha/${runId}`;

const startedBy = { id: 'acme-writer', name: 'acme-writer' };

export interface Left {
  readonly events: readonly RunEvent[];
  readonly type: string;
  readonly name: string;
  readonly leases: readonly (readonly [string, string, number])[];
}

export function startOf(
  data: Readonly<Partial<Record<'calls_tools' | 'resumes', true>>> = {},
  by: Readonly<typeof startedBy> = startedBy,
): RunEvent {
  return { type: 'run_started', data: { started_by: by, input: {}, ...data } };
}

function leasesWritten(leases: Left['leases']) {
  return Effect.flatMap(Effect.service(LedgerConnection), (connection) =>
    Effect.forEach(
      leases,
      ([name, holder, expiresAt]) =>
        Effect.promise(() =>
          connection.write(
            statement`INSERT INTO workflow_leases (name, holder, expires_at) VALUES (${name}, ${holder}, ${expiresAt})`,
          ),
        ),
      { discard: true },
    ),
  );
}

export function leftByAProcessThatDied(left: Left, heard: (runtime: HostRuntime) => void): StartingWork {
  return async ({ runtime }) => {
    heard(runtime);
    const context = {
      runId,
      by: startedBy.id,
      at: new Date(now - 60_000).toISOString(),
      definitionType: left.type,
      definitionName: left.name,
      definitionVersion: 1,
    };
    const recorded = Effect.flatMap(Effect.service(Ledger), (ledger) =>
      recordedAsGiven(ledger, `playbook/acme/alpha/runs/${runId}`, left.events, context),
    );
    await Effect.runPromise(inRuntime(runtime, Effect.andThen(recorded, leasesWritten(left.leases))));
    return { dueWork: [], consumers: [] };
  };
}

const LeaseNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

export async function leaseNamesIn(runtime: Promise<HostRuntime>): Promise<readonly string[]> {
  const read = Effect.flatMap(Effect.service(LedgerConnection), (connection) =>
    Effect.promise(() => connection.read(statement`SELECT name FROM workflow_leases WHERE name LIKE 'attempt/%'`)),
  );
  return LeaseNames(await Effect.runPromise(inRuntime(await runtime, read))).map(({ name }) => name);
}
