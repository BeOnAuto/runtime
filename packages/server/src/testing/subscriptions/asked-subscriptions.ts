import type { AskedSubscription, Asking, EventDestination } from '@on.auto/providers';

export function askedThroughTheFirstTaken(taken: Asking['taken'], topic: string): readonly AskedSubscription[] {
  return [...taken].flatMap(([connection, destinations]: readonly [string, readonly EventDestination[]]) =>
    destinations.slice(0, 1).map((destination) => ({ connection, topic, destination })),
  );
}
