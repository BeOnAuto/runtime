import type { PlaybookAddress } from '@on.auto/operations';
import type { CalledOnce, OneCall, RequestOnce } from '@on.auto/tool-servers';
import type { Effect, Redacted } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import type {
  SubscriptionCallFailed,
  SubscriptionFailedBecause,
  SubscriptionFailureKind,
} from './subscription-failed.ts';

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
  readonly connectionId: string;
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

export interface SubscriptionKey {
  readonly connection: string;
  readonly topic: string;
}

export interface Generation {
  readonly connected?: string;
  readonly declared: string;
}

export interface MadeSubscription {
  readonly type: Receiving;
  readonly id: string;
  readonly secretId?: string;
  readonly declared: string;
}

export interface RecordedFailure {
  readonly kind: SubscriptionFailureKind;
  readonly because: SubscriptionFailedBecause;
  readonly attempted?: Generation;
}

export interface Positions {
  readonly failures: number;
  readonly lapsesAt?: number;
  readonly dueAt?: number;
}

export interface RecordedSubscription extends SubscriptionKey {
  readonly made?: MadeSubscription;
  readonly failed?: RecordedFailure;
  readonly positions?: Positions;
}

export interface SubscriptionRecords {
  readonly read: (playbook: PlaybookAddress) => Effect.Effect<readonly RecordedSubscription[]>;
  readonly made: (playbook: PlaybookAddress, key: SubscriptionKey, made: MadeSubscription) => Effect.Effect<void>;
  readonly failed: (playbook: PlaybookAddress, key: SubscriptionKey, failed: RecordedFailure) => Effect.Effect<void>;
  readonly removed: (playbook: PlaybookAddress, key: SubscriptionKey) => Effect.Effect<void>;
  readonly moved: (playbook: PlaybookAddress, key: SubscriptionKey, positions: Positions) => Effect.Effect<void>;
  readonly holds: (part: string) => boolean;
}

export interface KeptSecret {
  readonly id: string;
  readonly secret: Redacted.Redacted;
}

export interface SubscriptionSecrets {
  readonly make: (place: SubscriptionPlace) => Effect.Effect<KeptSecret>;
  readonly keep: (place: SubscriptionPlace, secret: Redacted.Redacted) => Effect.Effect<string>;
  readonly read: (place: SubscriptionPlace, id: string) => Effect.Effect<Redacted.Redacted | undefined>;
  readonly forget: (place: SubscriptionPlace, id: string) => Effect.Effect<void>;
}

export interface LoopConnection {
  readonly id: string;
  readonly connection: string;
  readonly connected?: string;
  readonly destinations: readonly Destination[];
}

export interface Asking extends PlaybookAddress {
  readonly arranged: ReadonlyMap<string, Destination>;
}

export type Asker = (asking: Asking) => Effect.Effect<readonly SubscriptionKey[]>;

export interface SubscriptionLoopPorts extends SubscriptionPorts {
  readonly connectionsOf: (playbook: PlaybookAddress) => Effect.Effect<readonly LoopConnection[]>;
  readonly receives: (type: Destination['type']) => boolean;
  readonly askers: readonly Asker[];
  readonly records: SubscriptionRecords;
  readonly secrets: SubscriptionSecrets;
  readonly mostPerConnection: number;
}

export interface Reconciled {
  readonly nextDueAt?: number;
  readonly deadlineExceeded?: true;
}
