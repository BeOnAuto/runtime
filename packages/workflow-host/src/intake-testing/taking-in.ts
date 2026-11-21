import { connectionEventRecorder, type ReportedEvent } from '@on.auto/definitions/connection-events';
import { streamPortsOf } from '@on.auto/ledger';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { filterSandboxOf, freshInstances, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import {
  connectionEventIntakeOf,
  intakeMatching,
  type ConnectionArrival,
  type ServedConnection,
} from '../intake/connection-intake.ts';
import { countingMatches } from '../reaction-testing/trigger-starting.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

export const takenAt = Date.parse('2026-11-20T09:00:00.000Z');

export const source = '/connections/tickets';

export function arrivalOf(event: ReportedEvent, topic?: string): ConnectionArrival {
  const playbook = { org: 'acme', playbook: 'alpha' };
  return { playbook, connection: 'tickets', event, ...(topic === undefined ? {} : { topic }) };
}

export function servedWithTopics(...topics: readonly string[]): ServedConnection {
  return { topicsOf: () => Effect.succeed(topics) };
}

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk(sandboxShippedRoots()));

export async function anIntake(served: ServedConnection | 'not served' = servedWithTopics()) {
  const database = await openedOn(await onSQLite());
  const ports = {
    database,
    servedConnection: () => Effect.succeed(served === 'not served' ? undefined : served),
    record: connectionEventRecorder(streamPortsOf(database.store)),
    now: () => takenAt,
  };
  const scripted = intakeMatching({ ...ports, match: countingMatches().match });
  const sandboxed = connectionEventIntakeOf({ ...ports, filters: filterSandboxOf(freshInstances(sandboxModule)) });
  return {
    database,
    takenIn: (arrival: ConnectionArrival) => Effect.runPromise(scripted(arrival)),
    takenInASandbox: (arrival: ConnectionArrival) => Effect.runPromise(sandboxed(arrival)),
  };
}
