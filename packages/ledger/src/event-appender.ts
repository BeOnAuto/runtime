import { isExpectedVersionConflictError } from '@event-driven-io/emmett';
import { checkedContext, recordingOf, type Decided, type Recorded } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { eventCodecOf } from './event-codec.ts';
import type { AppendPlace, EncodedEvent, Streams } from './event-store.ts';
import { VersionConflict } from './version-conflict.ts';

export type EventAppender<Event extends Recorded> = (
  stream: string,
  events: readonly Decided<Event>[],
  place: AppendPlace,
) => Effect.Effect<void, VersionConflict>;

export function eventAppenderOf<Event extends Recorded>(
  store: Streams,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventAppender<Event> {
  const { encode } = eventCodecOf(eventSchema);
  const recorded = recordingOf(eventSchema);
  return (stream, events, place) => {
    if (events.length > store.mostEventsInOneAppend) {
      return Effect.die(
        new RangeError(
          `A decision on ${stream} gave ${events.length} events, more than ${store.mostEventsInOneAppend}`,
        ),
      );
    }
    return Effect.sync(() => checkedContext(place.context)).pipe(
      Effect.flatMap((context) =>
        Effect.forEach(events, (event) =>
          Effect.sync(() => recorded(event, context)).pipe(Effect.flatMap(encode)),
        ).pipe(
          Effect.flatMap((encoded: readonly EncodedEvent[]) =>
            Effect.tryPromise({
              try: () => store.append(stream, encoded, { ...place, context }),
              catch: (error) => error,
            }),
          ),
        ),
      ),
      Effect.catch((error) =>
        isExpectedVersionConflictError(error) ? Effect.fail(new VersionConflict()) : Effect.die(error),
      ),
    );
  };
}
