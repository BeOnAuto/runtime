import type { Recorded, StreamReader } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { RecordedMessage, StreamMessagesStore, Streams } from './event-store.ts';
import { foldEvents } from './fold-events.ts';
import type { StreamAgesStore } from './stream-ages/stream-ages-store.ts';

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

export type LastPositionOf = NonNullable<StreamAgesStore['lastPositionOf']>;

function readAfter(lastPositionOf: LastPositionOf | undefined, stream: string, lastFactAlone: boolean) {
  return lastPositionOf === undefined || !lastFactAlone
    ? Effect.succeed(0)
    : Effect.map(
        Effect.promise(() => lastPositionOf(stream)),
        (last) => Math.max(0, last - 1),
      );
}

export function streamReaderOf(store: Streams, lastPositionOf?: LastPositionOf): StreamReader['load'] {
  return (stream, fold) =>
    Effect.gen(function* () {
      const after = yield* readAfter(lastPositionOf, stream, fold.lastFactAlone === true);
      const recorded = yield* Effect.promise(() => store.read(stream, after));
      const events = yield* Effect.forEach(recorded.messages, eventCodecOf(fold.eventSchema).decode);
      return { state: foldEvents(fold.evolve, fold.initialState, events), version: recorded.version };
    });
}
