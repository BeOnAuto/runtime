import type { PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { actedOn, type Round } from './subscription-acts.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import { decided, type Step, type Wanted } from './subscription-decisions.ts';
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

interface Acted {
  readonly later: readonly number[];
  readonly cutAt?: number;
}

function actedOnBefore(round: Round, steps: readonly Step[], deadline: number | undefined): Effect.Effect<Acted> {
  return Effect.gen(function* () {
    const later: number[] = [];
    for (const step of steps) {
      if (deadline !== undefined) {
        const at = yield* Clock.currentTimeMillis;
        if (at >= deadline) {
          return { later, cutAt: at };
        }
      }
      later.push(...(yield* actedOn(round, step)));
    }
    return { later };
  });
}

function reconciledOf(next: number | undefined, cutAt: number | undefined): Reconciled {
  const due = next === undefined ? {} : { nextDueAt: next };
  return cutAt === undefined ? due : { ...due, deadlineExceeded: true };
}

export function subscriptionLoopOf(
  ports: SubscriptionLoopPorts,
): (playbook: PlaybookAddress, deadline?: number) => Effect.Effect<Reconciled> {
  const calls = subscriptionCallsOf(ports);
  return (playbook, deadline) =>
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
      const { later, cutAt } = yield* actedOnBefore({ ports, calls, playbook, now }, steps, deadline);
      return reconciledOf(earliest(nextDueAt, cutAt, ...later), cutAt);
    });
}
