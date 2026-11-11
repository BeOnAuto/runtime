import type { Recorded, StreamReader } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { RecordedMessage, StreamMessagesStore, Streams } from './event-store.ts';
import { foldEvents } from './fold-events.ts';

function decodedOf<Event extends Recorded>(
  message: RecordedMessage | undefined,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): Effect.Effect<Event | undefined> {
  return message === undefined ? Effect.undefined : eventCodecOf(eventSchema).decode(message);
}

function atAWholePosition<Event extends Recorded>(
  position: number,
  read: () => Effect.Effect<Event | undefined>,
): Effect.Effect<Event | undefined> {
  return Number.isSafeInteger(position) ? read() : Effect.undefined;
}

export function factReaderOf(store: StreamMessagesStore): StreamReader['factAt'] {
  return (stream, position, eventSchema) =>
    atAWholePosition(position, () =>
      Effect.promise(() => store.messageAt(stream, position)).pipe(
        Effect.flatMap((message) => decodedOf(message, eventSchema)),
      ),
    );
}

export function streamReaderOf(store: Streams): StreamReader['load'] {
  return (stream, fold) =>
    Effect.gen(function* () {
      const recorded = yield* Effect.promise(() => store.read(stream));
      const events = yield* Effect.forEach(recorded.messages, eventCodecOf(fold.eventSchema).decode);
      return { state: foldEvents(fold.evolve, fold.initialState, events), version: recorded.version };
    });
}
