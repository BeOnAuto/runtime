import { connectionEventRecorder, type ReportedEvent } from '@on.auto/definitions/connection-events';
import { savedTriggersOf } from '@on.auto/definitions/connection-triggers';
import { streamPortsOf } from '@on.auto/ledger';
import type { PlaybookRegistry } from '@on.auto/operations';
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
import { aPlaybookBesideItsLedger } from './saved-workflows.ts';

export const takenAt = Date.parse('2026-11-20T09:00:00.000Z');

export const source = '/connections/tickets';

export function arrivalOf(event: ReportedEvent, topic?: string): ConnectionArrival {
  const playbook = { org: 'acme', playbook: 'alpha' };
  return { playbook, connection: 'tickets', event, ...(topic === undefined ? {} : { topic }) };
}

export function servedWithTopics(...topics: readonly string[]): ServedConnection {
  return { topicsOf: () => Effect.succeed(topics), declaresEventTypes: true };
}

export const servedListingNoEvents: ServedConnection = { ...servedWithTopics(), declaresEventTypes: false };

export function servedActingAs(user: string, ...topics: readonly string[]): ServedConnection {
  return { ...servedWithTopics(...topics), user };
}

type Registry = PlaybookRegistry['Service'];

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk(sandboxShippedRoots()));

export async function anIntake(
  served: ServedConnection | 'not served' = servedWithTopics(),
  savedTriggersRead: typeof savedTriggersOf = savedTriggersOf,
  registryOver: (ofTheLedger: Registry) => Registry = (ofTheLedger) => ofTheLedger,
) {
  const { database, ledger, registry, workflows, playbook } = await aPlaybookBesideItsLedger();
  const ports = {
    database,
    servedConnection: () => Effect.succeed(served === 'not served' ? undefined : served),
    registry: registryOver(registry),
    savedTriggers: savedTriggersRead(ledger),
    record: connectionEventRecorder(streamPortsOf(database.store)),
    now: () => takenAt,
  };
  const scripted = intakeMatching({ ...ports, match: countingMatches().match });
  const sandboxed = connectionEventIntakeOf({ ...ports, filters: filterSandboxOf(freshInstances(sandboxModule)) });
  return {
    database,
    workflows,
    playbook,
    takenIn: (arrival: ConnectionArrival) => Effect.runPromise(scripted(arrival)),
    takenInASandbox: (arrival: ConnectionArrival) => Effect.runPromise(sandboxed(arrival)),
    failureOf: (arrival: ConnectionArrival) => Effect.runPromise(Effect.flip(Effect.sandbox(scripted(arrival)))),
  };
}
