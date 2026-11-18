import type { PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { actedOn } from './subscription-acts.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import { decided, type Wanted } from './subscription-decisions.ts';
import type { LoopConnection, Reconciled, SubscriptionKey, SubscriptionLoopPorts } from './subscription-ports.ts';
import { earliest, isArranging, type Arranging } from './subscription-records.ts';

function isTakenBy(ports: SubscriptionLoopPorts, place: PlaybookAddress & { readonly connection: string }) {
  return ({ type }: Destination): boolean =>
    ports.receives(type) && (type === 'websocket' || ports.callbackOf(place, type) !== undefined);
}

function arrangedThrough(
  ports: SubscriptionLoopPorts,
  playbook: PlaybookAddress,
  { connection, destinations }: LoopConnection,
): Arranging | undefined {
  const takes = isTakenBy(ports, { ...playbook, connection });
  const taken = destinations.find((destination) => takes(destination));
  return taken !== undefined && isArranging(taken) ? taken : undefined;
}

function arrangedOf(
  ports: SubscriptionLoopPorts,
  playbook: PlaybookAddress,
  connections: readonly LoopConnection[],
): ReadonlyMap<string, Arranging> {
  return new Map(
    connections.flatMap((each) => {
      const arranged = arrangedThrough(ports, playbook, each);
      return arranged === undefined ? [] : [[each.connection, arranged] as const];
    }),
  );
}

function wantedIn(
  ports: SubscriptionLoopPorts,
  arranged: ReadonlyMap<string, Arranging>,
  asked: readonly SubscriptionKey[],
): readonly Wanted[] {
  return asked.flatMap(({ connection, topic }) => {
    const destination = arranged.get(connection);
    return destination !== undefined && ports.records.holds(topic) ? [{ connection, topic, destination }] : [];
  });
}

export function subscriptionLoopOf(
  ports: SubscriptionLoopPorts,
): (playbook: PlaybookAddress) => Effect.Effect<Reconciled> {
  const calls = subscriptionCallsOf(ports);
  return (playbook) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const connections = yield* ports.connectionsOf(playbook);
      const arranged = arrangedOf(ports, playbook, connections);
      const asked = yield* Effect.forEach(ports.askers, (asker) => asker({ ...playbook, arranged }));
      const recorded = yield* ports.records.read(playbook);
      const { steps, nextDueAt } = decided({
        now,
        mostPerConnection: ports.mostPerConnection,
        connections: new Map(connections.map((each) => [each.connection, each])),
        wanted: wantedIn(ports, arranged, asked.flat()),
        recorded,
      });
      const round = { ports, calls, playbook, now };
      const later = yield* Effect.forEach(steps, (step) => actedOn(round, step));
      const next = earliest(nextDueAt, ...later.flat());
      return next === undefined ? {} : { nextDueAt: next };
    });
}
