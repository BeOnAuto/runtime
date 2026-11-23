import type { PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { actedOn } from './subscription-acts.ts';
import { subscriptionCallsOf } from './subscription-calls.ts';
import { decided, type Step, type Wanted } from './subscription-decisions.ts';
import type { SubscriptionCallFailed } from './subscription-failed.ts';
import { identitiesReadWith } from './subscription-identities.ts';
import type {
  AskedSubscription,
  Asking,
  LoopConnection,
  Reconciled,
  SubscriptionKey,
  SubscriptionLoopPorts,
} from './subscription-ports.ts';
import { earliest, isSubscribable, keyOf } from './subscription-records.ts';

function isTakenBy(ports: SubscriptionLoopPorts, place: PlaybookAddress & { readonly connection: string }) {
  return ({ type }: Destination): boolean =>
    ports.receives(type) && (type === 'websocket' || type === 'polling' || ports.callbackOf(place, type) !== undefined);
}

function takenThrough(
  ports: SubscriptionLoopPorts,
  playbook: PlaybookAddress,
  { connection, destinations }: LoopConnection,
): readonly Destination[] {
  const takes = isTakenBy(ports, { ...playbook, connection });
  return destinations.filter((destination) => takes(destination));
}

function takenOf(
  ports: SubscriptionLoopPorts,
  playbook: PlaybookAddress,
  connections: readonly LoopConnection[],
): ReadonlyMap<string, readonly Destination[]> {
  return new Map(
    connections.flatMap((each) => {
      const taken = takenThrough(ports, playbook, each);
      return taken.some((destination) => isSubscribable(destination)) ? [[each.connection, taken] as const] : [];
    }),
  );
}

function wantedIn(ports: SubscriptionLoopPorts, asked: readonly AskedSubscription[]): readonly Wanted[] {
  return asked.flatMap(({ connection, topic, destination }) =>
    isSubscribable(destination) && ports.receives(destination.type) && ports.records.holds(topic)
      ? [{ connection, topic, destination }]
      : [],
  );
}

function owingThrough(connections: readonly LoopConnection[], wanted: readonly Wanted[]): readonly LoopConnection[] {
  const through = new Set(wanted.map(({ connection }) => connection));
  return connections.filter(({ connection, identify }) => identify !== undefined && through.has(connection));
}

interface Triggered {
  readonly owing: readonly LoopConnection[];
  readonly keys: readonly SubscriptionKey[];
}

const nothingTriggered: Triggered = { owing: [], keys: [] };

function triggeredThrough(
  ports: SubscriptionLoopPorts,
  asking: Asking,
  owing: readonly LoopConnection[],
): Effect.Effect<Triggered> {
  if (owing.length === 0) {
    return Effect.succeed(nothingTriggered);
  }
  return Effect.map(ports.triggersAsker(asking), (keys) => {
    const asked = new Set(keys.map(({ connection }) => connection));
    return { owing: owing.filter(({ connection }) => asked.has(connection)), keys };
  });
}

type ReadFailure = Pick<SubscriptionCallFailed, 'kind' | 'because'>;

function unreadForEach(
  keys: readonly SubscriptionKey[],
  unread: ReadonlyMap<string, ReadFailure>,
): ReadonlyMap<string, ReadFailure> {
  return new Map(
    keys.flatMap((key) => {
      const failure = unread.get(key.connection);
      return failure === undefined ? [] : [[keyOf(key), failure] as const];
    }),
  );
}

interface Acted {
  readonly later: readonly number[];
  readonly cutAt?: number;
}

function actedOnBefore(
  round: Parameters<typeof actedOn>[0],
  steps: readonly Step[],
  deadline: number | undefined,
): Effect.Effect<Acted> {
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
  const identitiesRead = identitiesReadWith(ports, calls);
  return (playbook, deadline) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const connections = yield* ports.connectionsOf(playbook);
      const asking = { ...playbook, taken: takenOf(ports, playbook, connections) };
      const asked = yield* Effect.forEach(ports.askers, (asker) => asker(asking));
      const recorded = yield* ports.records.read(playbook);
      const byName = new Map(connections.map((each) => [each.connection, each]));
      const wanted = wantedIn(ports, asked.flat());
      const { steps, nextDueAt } = decided({
        now,
        mostPerConnection: ports.mostPerConnection,
        connections: byName,
        wanted,
        recorded,
      });
      const triggered = yield* triggeredThrough(ports, asking, owingThrough(connections, wanted));
      const { unread, cutAt: cutReading } = yield* identitiesRead(playbook, triggered.owing, deadline);
      if (cutReading !== undefined) {
        return reconciledOf(earliest(nextDueAt, cutReading), cutReading);
      }
      const unreadFor = unreadForEach(triggered.keys, unread);
      const round = { ports, calls, playbook, now, connections: byName, unreadFor };
      const { later, cutAt } = yield* actedOnBefore(round, steps, deadline);
      return reconciledOf(earliest(nextDueAt, cutAt, ...later), cutAt);
    });
}
