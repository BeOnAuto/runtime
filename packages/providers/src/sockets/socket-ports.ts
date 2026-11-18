import { Data, type Effect, type Redacted, type Scope } from 'effect';

import type { ArrivalReading } from '../events/arrival-readings.ts';
import type { Destination } from '../events/destination-fields.ts';

export type SocketEnd = 'not opened' | 'closed' | 'silent';

export class SocketEnded extends Data.TaggedError('socket_ended')<{
  readonly end: SocketEnd;
  readonly code?: number;
}> {}

export type SocketFrame = { readonly kind: 'message'; readonly text: string } | { readonly kind: 'pong' };

export interface OpenSocket {
  readonly next: Effect.Effect<SocketFrame, SocketEnded>;
  readonly send: (text: string) => Effect.Effect<void, SocketEnded>;
  readonly ping: Effect.Effect<void, SocketEnded>;
}

export interface SocketOpening {
  readonly destination: Destination;
  readonly credential: Redacted.Redacted;
}

export type OpensASocket = (opening: SocketOpening) => Effect.Effect<OpenSocket, SocketEnded, Scope.Scope>;

export interface SocketArrival {
  readonly reading: ArrivalReading;
}

export type Arrived = (arrival: SocketArrival) => Effect.Effect<void>;
