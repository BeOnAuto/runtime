import { sha256Of } from '@on.auto/content';

import type { Destination } from '../events/destination-fields.ts';
import type { SubscriptionFailureKind } from './subscription-failed.ts';
import type { Generation, Positions, Receiving, RecordedFailure, SubscriptionKey } from './subscription-ports.ts';

type Call = NonNullable<Destination['unsubscribe']>;

export type Arranging = Destination & {
  readonly type: Receiving;
  readonly topic: string;
  readonly subscribe: NonNullable<Destination['subscribe']>;
  readonly unsubscribe: Call;
};

export function isArranging(destination: Destination): destination is Arranging {
  const { type, per, topic, subscribe, unsubscribe } = destination;
  return (
    type !== 'websocket' &&
    per === 'subscription' &&
    topic !== undefined &&
    subscribe !== undefined &&
    unsubscribe !== undefined
  );
}

export function declaredOf({ type, subscribe, renew, unsubscribe, lease_seconds: leaseSeconds }: Arranging): string {
  return sha256Of(JSON.stringify({ type, subscribe, renew, unsubscribe, lease_seconds: leaseSeconds }));
}

export function lapses({ lease_seconds: leaseSeconds, subscribe }: Arranging): boolean {
  return leaseSeconds !== undefined || subscribe.subscribed.expires_at !== undefined;
}

export function generationOf(connected: string | undefined, destination: Arranging): Generation {
  const declared = declaredOf(destination);
  return connected === undefined ? { declared } : { connected, declared };
}

export function isLasting(kind: SubscriptionFailureKind): boolean {
  return kind !== 'unreachable';
}

function isTheSameGeneration(left: Generation | undefined, right: Generation | undefined): boolean {
  return left?.connected === right?.connected && left?.declared === right?.declared;
}

export function isHeldBy(failed: RecordedFailure | undefined, generation: Generation): boolean {
  return failed?.attempted !== undefined && isLasting(failed.kind) && isTheSameGeneration(failed.attempted, generation);
}

export function isTheSameFailure(left: RecordedFailure | undefined, right: RecordedFailure): boolean {
  return (
    left !== undefined &&
    left.kind === right.kind &&
    left.because === right.because &&
    isTheSameGeneration(left.attempted, right.attempted)
  );
}

export function keyOf({ connection, topic }: SubscriptionKey): string {
  return JSON.stringify([connection, topic]);
}

export function earliest(...times: readonly (number | undefined)[]): number | undefined {
  const known = times.filter((time) => time !== undefined);
  return known.length === 0 ? undefined : Math.min(...known);
}

export function isWaitingToRetry(positions: Positions | undefined, now: number): boolean {
  return positions !== undefined && positions.failures > 0 && positions.dueAt !== undefined && positions.dueAt > now;
}
