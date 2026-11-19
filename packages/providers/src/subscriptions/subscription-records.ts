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
    (!isLasting(right.kind) || left.because === right.because) &&
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

const millisOfASecond = 1000;

const renewedHalfwayThrough = 0.5;

export function leaseFrom(now: number, { lease_seconds: leaseSeconds }: Arranging, expiresAt?: string): Positions {
  const declared = leaseSeconds === undefined ? undefined : now + leaseSeconds * millisOfASecond;
  const lapsesAt = expiresAt === undefined ? declared : Date.parse(expiresAt);
  if (lapsesAt === undefined || lapsesAt <= now) {
    return { failures: 0 };
  }
  return { failures: 0, lapsesAt, dueAt: now + (lapsesAt - now) * renewedHalfwayThrough };
}

export function withLapse(positions: Positions, lapsesAt: number | undefined): Positions {
  return lapsesAt === undefined ? positions : { ...positions, lapsesAt };
}

export const resyncedAfterMs = 10 * 60 * 60 * 1000;

const idempotentMethods: ReadonlySet<string> = new Set(['GET', 'PUT', 'DELETE']);

function makesAgainSafely({ subscribe }: Arranging): boolean {
  return subscribe.method !== undefined && idempotentMethods.has(subscribe.method);
}

export interface Retrying {
  readonly because: string;
  readonly makes: boolean;
}

export function retryWaitOf(destination: Arranging, { because, makes }: Retrying, waitMs: number): number {
  const outcomeUnknown = makes && because === 'timed_out' && !makesAgainSafely(destination);
  return outcomeUnknown ? Math.max(waitMs, resyncedAfterMs) : waitMs;
}
