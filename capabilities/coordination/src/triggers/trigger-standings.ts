import type { EventTrigger, StandingRequest, Trigger } from '@on.auto/definitions';
import { Effect, type Schema } from 'effect';

import { listeningOf, type ConnectionEvents, type Listening } from './connection-triggers.ts';

function filtersNamingAConnection(triggers: readonly Trigger[]): readonly Listening[] {
  return triggers
    .filter((trigger): trigger is EventTrigger => trigger.kind === 'event')
    .flatMap(({ filters }) => filters)
    .flatMap((filter) => listeningOf(filter));
}

function standingOfEach(
  events: ConnectionEvents,
  { org, playbook, status }: StandingRequest,
  listening: Listening,
): Effect.Effect<Schema.JsonObject> {
  const { reference, connection, type, subject } = listening;
  const asked = { connection, type, paused: status === 'paused', ...(subject === undefined ? {} : { subject }) };
  return Effect.map(events.standingOf({ org, playbook }, asked), (standing) => ({
    reference,
    connection,
    ...(standing.event === undefined ? {} : { event: standing.event }),
    ...(standing.subjectName === undefined ? {} : { subject_name: standing.subjectName }),
    speed: standing.speed,
    ...(standing.pollingIntervalSeconds === undefined
      ? {}
      : { polling_interval_seconds: standing.pollingIntervalSeconds }),
    listening: standing.listening,
    not_listening_because: standing.notListeningBecause,
    needs_reconnecting: standing.needsReconnecting,
  }));
}

type TriggersStanding = (request: StandingRequest) => Effect.Effect<readonly Schema.JsonObject[] | undefined>;

export function triggersStandingOf(events: ConnectionEvents): TriggersStanding {
  return (request: StandingRequest) => {
    const listening = filtersNamingAConnection(request.status === 'retired' ? [] : (request.triggers ?? []));
    return listening.length === 0
      ? Effect.undefined
      : Effect.forEach(listening, (each) => standingOfEach(events, request, each));
  };
}
