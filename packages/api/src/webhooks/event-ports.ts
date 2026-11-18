import type { Received } from '@on.auto/identity';
import type { Arrival, ArrivalReading, EventDestination, PresentedProof } from '@on.auto/providers';
import type { Redacted } from 'effect';

import type { DeliveryBounds } from './delivery-bounds.ts';
import type { Limiter } from './delivery-limits.ts';

export interface EventAddress {
  readonly org: string;
  readonly playbook: string;
  readonly connection: string;
}

export interface ArrivedEvent {
  readonly address: EventAddress;
  readonly reading: ArrivalReading;
  readonly arrival: Arrival;
  readonly provesTheBodyAndATime: boolean;
}

export type EventOutcome =
  | 'arrived'
  | 'passed_over'
  | 'handshake'
  | 'malformed'
  | 'limited'
  | 'unread'
  | 'unknown'
  | 'unsigned'
  | 'stale'
  | 'mismatched';

export interface HeardEvent {
  readonly address: EventAddress | undefined;
  readonly outcome: EventOutcome;
  readonly status: number;
  readonly bytes: number;
}

type Verify = NonNullable<EventDestination['verify']>;

export interface EventServing {
  readonly destination: (address: EventAddress) => Promise<EventDestination | undefined>;
  readonly secrets: (address: EventAddress, secret: Verify['secret']) => Promise<readonly Redacted.Redacted[]>;
  readonly arrived: (event: ArrivedEvent) => Promise<void>;
  readonly heard: (event: HeardEvent) => void;
  readonly now?: () => number;
  readonly bounds?: DeliveryBounds;
}

export interface EventDoor {
  readonly serving: EventServing;
  readonly limiter: Limiter;
  readonly bounds: DeliveryBounds;
  readonly now: () => number;
  readonly heard: (event: Omit<HeardEvent, 'status'>, response: Readonly<Response>) => Response;
}

export interface DestinedDelivery {
  readonly address: EventAddress;
  readonly body: Readonly<Uint8Array>;
  readonly destination: EventDestination;
  readonly arrival: Arrival;
}

export interface Proven {
  readonly verify: Verify;
  readonly presented: PresentedProof;
  readonly secrets: readonly Redacted.Redacted[];
  readonly received: Received;
}
