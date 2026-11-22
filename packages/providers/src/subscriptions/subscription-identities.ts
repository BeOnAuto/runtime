import type { PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Option } from 'effect';

import { subscriptionCallsOf } from './subscription-calls.ts';
import type { SubscriptionCallFailed } from './subscription-failed.ts';
import type { Identity, LoopConnection, SubscriptionCalls, SubscriptionLoopPorts } from './subscription-ports.ts';

type Owing = LoopConnection & { readonly identify: Identity; readonly connected: string };

type ReadFailure = Pick<SubscriptionCallFailed, 'kind' | 'because'>;

interface IdentitiesRead {
  readonly unread: ReadonlyMap<string, ReadFailure>;
  readonly cutAt?: number;
}

type IdentityPorts = Pick<SubscriptionLoopPorts, 'identified'>;

type IdentitiesReading = (
  playbook: PlaybookAddress,
  connections: readonly LoopConnection[],
  deadline?: number,
) => Effect.Effect<IdentitiesRead>;

function owesItsIdentity(connection: LoopConnection): connection is Owing {
  return connection.identify !== undefined && connection.connected !== undefined;
}

function readOf(ports: IdentityPorts, calls: Pick<SubscriptionCalls, 'identify'>, playbook: PlaybookAddress) {
  return (owing: Owing): Effect.Effect<Option.Option<ReadFailure>> => {
    const place = { ...playbook, connection: owing.connection };
    return Effect.matchEffect(calls.identify({ identity: owing.identify, place }), {
      onFailure: ({ kind, because }: ReadFailure) => Effect.succeed(Option.some({ kind, because })),
      onSuccess: (user) => Effect.as(ports.identified(playbook, owing, user), Option.none()),
    });
  };
}

function isPast(deadline: number | undefined): Effect.Effect<number | undefined> {
  if (deadline === undefined) {
    return Effect.undefined;
  }
  return Effect.map(Clock.currentTimeMillis, (at) => (at >= deadline ? at : undefined));
}

export function identitiesReadWith(
  ports: IdentityPorts,
  calls: Pick<SubscriptionCalls, 'identify'>,
): IdentitiesReading {
  return (playbook, connections, deadline) =>
    Effect.gen(function* () {
      const read = readOf(ports, calls, playbook);
      const unread = new Map<string, ReadFailure>();
      for (const owing of connections.filter((each) => owesItsIdentity(each))) {
        const cutAt = yield* isPast(deadline);
        if (cutAt !== undefined) {
          return { unread, cutAt };
        }
        const failure = yield* read(owing);
        if (Option.isSome(failure)) {
          unread.set(owing.connection, failure.value);
        }
      }
      return { unread };
    });
}

export function identitiesReadOf(ports: SubscriptionLoopPorts): IdentitiesReading {
  return identitiesReadWith(ports, subscriptionCallsOf(ports));
}
