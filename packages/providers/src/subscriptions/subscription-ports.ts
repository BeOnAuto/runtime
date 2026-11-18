import type { CalledOnce, OneCall, RequestOnce } from '@on.auto/tool-servers';
import type { Effect, Redacted } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import type { SubscriptionCallFailed } from './subscription-failed.ts';

export interface ThroughTheConnection {
  readonly callOnce: (call: OneCall) => Effect.Effect<CalledOnce>;
  readonly requestOnce: RequestOnce;
  readonly mostRequestBytesTo: (server: string) => number;
}

export interface SubscriptionPlace {
  readonly org: string;
  readonly playbook: string;
  readonly connection: string;
}

export type Receiving = Exclude<Destination['type'], 'websocket'>;

export interface SubscriptionPorts extends ThroughTheConnection {
  readonly callbackOf: (place: SubscriptionPlace, type: Receiving) => string | undefined;
}

type Declaring<Act extends 'subscribe' | 'renew' | 'unsubscribe'> = Destination & Required<Pick<Destination, Act>>;

interface Asked<Act extends 'subscribe' | 'renew' | 'unsubscribe'> {
  readonly destination: Declaring<Act>;
  readonly place: SubscriptionPlace;
  readonly topic: string;
}

export interface Subscribing<E, R> extends Asked<'subscribe'> {
  readonly madeSecret: Effect.Effect<Redacted.Redacted, E, R>;
}

export interface HeldSubscription {
  readonly id: string;
  readonly expiresAt?: string;
}

export interface Renewing extends Asked<'renew'> {
  readonly subscription: HeldSubscription;
}

export interface Unsubscribing extends Asked<'unsubscribe'> {
  readonly subscription: HeldSubscription;
}

export type SubscriptionSecret = 'made' | { readonly answered: Redacted.Redacted };

export interface Subscribed {
  readonly id: string;
  readonly expiresAt?: string;
  readonly secret?: SubscriptionSecret;
}

export interface Renewed {
  readonly expiresAt?: string;
}

export interface SubscriptionCalls {
  readonly subscribe: <E, R>(asked: Subscribing<E, R>) => Effect.Effect<Subscribed, SubscriptionCallFailed | E, R>;
  readonly renew: (asked: Renewing) => Effect.Effect<Renewed, SubscriptionCallFailed>;
  readonly unsubscribe: (asked: Unsubscribing) => Effect.Effect<void, SubscriptionCallFailed>;
}
