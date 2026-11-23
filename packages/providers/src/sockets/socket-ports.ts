import type { BearerSending, DeclaredRequest, RequestedOnce } from '@on.auto/tool-servers';
import { Data, type Effect, type Redacted, type Scope } from 'effect';

import type { ArrivalReading } from '../events/arrival-readings.ts';
import type { ChatMessage } from '../events/chat-arrivals.ts';
import type { Destination } from '../events/destination-fields.ts';

export type SocketEnd = 'not opened' | 'closed' | 'silent' | 'refused';

export class SocketEnded extends Data.TaggedError('socket_ended')<{
  readonly end: SocketEnd;
  readonly code?: number;
  readonly host?: string;
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
  readonly failureCodes?: BearerSending['failureCodes'];
}

export type OpensASocket = (opening: SocketOpening) => Effect.Effect<OpenSocket, SocketEnded, Scope.Scope>;

export type SendsABearerRequest = (request: DeclaredRequest, sending: BearerSending) => Effect.Effect<RequestedOnce>;

export type ConstructsASocket = (address: Redacted.Redacted) => Effect.Effect<OpenSocket, SocketEnded, Scope.Scope>;

export interface SocketArrival {
  readonly reading: ArrivalReading;
  readonly chat?: ChatMessage;
}

export type Arrived = (arrival: SocketArrival) => Effect.Effect<void>;
