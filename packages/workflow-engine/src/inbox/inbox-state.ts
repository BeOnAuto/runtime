import { Schema } from 'effect';

import { ReceivedEventSchema, type ReceivedEvent } from './received-event.ts';

export interface WaitingEvent {
  readonly event: ReceivedEvent;
  readonly bytes: number;
}

export interface InboxState {
  readonly waiting: readonly WaitingEvent[];
  readonly waitingBytes: number;
  readonly receivedIds: readonly string[];
  readonly offeredIds: readonly string[];
  readonly received: number;
  readonly receivedBytes: number;
}

export const InboxStateSchema: Schema.Codec<InboxState> = Schema.Struct({
  waiting: Schema.Array(Schema.Struct({ event: ReceivedEventSchema, bytes: Schema.Int })),
  waitingBytes: Schema.Int,
  receivedIds: Schema.Array(Schema.String),
  offeredIds: Schema.Array(Schema.String),
  received: Schema.Int,
  receivedBytes: Schema.Int,
});
