import type { Recorded } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { EncodedEvent, RecordedMessage } from './event-store.ts';

export interface EventCodec<Event extends Recorded> {
  readonly encode: (event: Event) => Effect.Effect<EncodedEvent>;
  readonly decode: (message: RecordedMessage) => Effect.Effect<Event>;
}

const asEncodedEvent = Schema.decodeUnknownEffect(Schema.Struct({ type: Schema.String, data: Schema.JsonObject }));

export function eventCodecOf<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventCodec<Event> {
  const json = Schema.toCodecJson(eventSchema);
  const encodeJson = Schema.encodeUnknownEffect(json);
  const decodeJson = Schema.decodeUnknownEffect(json);
  return {
    encode: (event) => encodeJson(event).pipe(Effect.flatMap(asEncodedEvent), Effect.orDie),
    decode: ({ type, data, context }) => Effect.orDie(decodeJson({ type, data, context })),
  };
}
