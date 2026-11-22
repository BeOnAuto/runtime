import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { subscriptionCallsOf } from './subscription-calls.ts';
import type { SubscriptionCallFailed } from './subscription-failed.ts';
import { isPast } from './subscription-identities.ts';
import type { LoopConnection, PlaceNaming, SubscriptionCalls, SubscriptionLoopPorts } from './subscription-ports.ts';
import { isLasting } from './subscription-records.ts';
import type { ConnectionTrigger } from './subscription-topics.ts';

type ReadingNames = LoopConnection & { readonly connected: string; readonly placeNaming: readonly PlaceNaming[] };

interface OwedName {
  readonly naming: PlaceNaming;
  readonly subject: string;
}

type NamingPorts = Pick<SubscriptionLoopPorts, 'placeNamed'>;

type NamingCalls = Pick<SubscriptionCalls, 'name'>;

type PlaceNamesReading = (
  playbook: PlaybookAddress,
  connections: readonly LoopConnection[],
  triggers: readonly ConnectionTrigger[],
  deadline?: number,
) => Effect.Effect<void>;

function readsNames(connection: LoopConnection): connection is ReadingNames {
  return connection.connected !== undefined && connection.placeNaming !== undefined;
}

function owedThrough(
  { connection, placeNaming }: ReadingNames,
  triggers: readonly ConnectionTrigger[],
): readonly OwedName[] {
  const owed = triggers.flatMap(({ connection: through, type, subject }): readonly (readonly [string, OwedName])[] => {
    const naming = placeNaming.find((each) => each.type === type);
    return through !== connection || subject === undefined || naming === undefined || naming.named.includes(subject)
      ? []
      : [[JSON.stringify([type, subject]), { naming, subject }]];
  });
  return [...new Map(owed).values()];
}

function readGoesOnOf(ports: NamingPorts, calls: NamingCalls, playbook: PlaybookAddress, through: ReadingNames) {
  const place = { ...playbook, connection: through.connection };
  return ({ naming, subject }: OwedName): Effect.Effect<boolean> =>
    Effect.matchEffect(calls.name({ name: naming.name, place, subject }), {
      onFailure: ({ kind }: Pick<SubscriptionCallFailed, 'kind'>) => Effect.succeed(isLasting(kind)),
      onSuccess: (name) => Effect.as(ports.placeNamed(playbook, through, { type: naming.type, subject, name }), true),
    });
}

function cutAtTheDeadline(
  readGoesOn: (owed: OwedName) => Effect.Effect<boolean>,
  owed: readonly OwedName[],
  deadline: number | undefined,
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    for (const each of owed) {
      if ((yield* isPast(deadline)) !== undefined) {
        return true;
      }
      if (!(yield* readGoesOn(each))) {
        return false;
      }
    }
    return false;
  });
}

export function placeNamesReadWith(ports: NamingPorts, calls: NamingCalls): PlaceNamesReading {
  return (playbook, connections, triggers, deadline) =>
    Effect.gen(function* () {
      for (const through of connections.filter((each) => readsNames(each))) {
        const readGoesOn = readGoesOnOf(ports, calls, playbook, through);
        if (yield* cutAtTheDeadline(readGoesOn, owedThrough(through, triggers), deadline)) {
          return;
        }
      }
    });
}

export function placeNamesReadOf(ports: SubscriptionLoopPorts): PlaceNamesReading {
  return placeNamesReadWith(ports, subscriptionCallsOf(ports));
}
