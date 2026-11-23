import type { Destination } from '../events/destination-fields.ts';
import type {
  Generation,
  MadeByPolling,
  MadeSubscription,
  MadeThroughACall,
  Receiving,
  RecordedSubscription,
  SubscriptionKey,
} from './subscription-ports.ts';
import {
  generationOf,
  isArranging,
  isPolled,
  type Arranging,
  type Polled,
  type Subscribable,
} from './subscription-records.ts';

export interface ConnectionState {
  readonly connected?: string;
  readonly destinations: readonly Destination[];
}

export interface Through {
  readonly destination: Subscribable;
  readonly generation: Generation;
}

interface Acting {
  readonly key: SubscriptionKey;
  readonly recorded?: RecordedSubscription | undefined;
}

export interface HeldThroughACall extends Acting {
  readonly recorded: RecordedSubscription;
  readonly made: MadeThroughACall;
  readonly destination: Arranging;
  readonly generation: Generation;
}

export interface HeldByPolling extends Acting {
  readonly recorded: RecordedSubscription;
  readonly made: MadeByPolling;
  readonly destination: Polled;
  readonly generation: Generation;
}

export type Held = HeldThroughACall | HeldByPolling;

export function keyIn({ connection, topic }: SubscriptionKey): SubscriptionKey {
  return { connection, topic };
}

function declarationOf(state: ConnectionState | undefined, type: Receiving): Arranging | undefined {
  return state?.destinations.filter((destination) => isArranging(destination)).find((each) => each.type === type);
}

export function throughOf<Kept extends Subscribable>(state: ConnectionState | undefined, destination: Kept) {
  return { destination, generation: generationOf(state?.connected, destination) };
}

export function heldThroughACallOf(
  row: RecordedSubscription,
  made: MadeThroughACall,
  state: ConnectionState | undefined,
) {
  const declared = declarationOf(state, made.type);
  return declared === undefined
    ? undefined
    : ({ key: keyIn(row), recorded: row, made, ...throughOf(state, declared) } satisfies HeldThroughACall);
}

export function isHeldByPolling(held: Held): held is HeldByPolling {
  return held.made.type === 'polling';
}

export function arrangedAs(row: RecordedSubscription, made: MadeSubscription, through: Through): Held | undefined {
  const { destination, generation } = through;
  const asDeclared = made.declared === generation.declared;
  const holding = { key: keyIn(row), recorded: row, generation };
  if (made.type === 'polling') {
    return isPolled(destination) && asDeclared ? { ...holding, made, destination } : undefined;
  }
  return isArranging(destination) && destination.type === made.type && asDeclared
    ? { ...holding, made, destination }
    : undefined;
}
