import { checkedContext, type Decided, type Recorded } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { eventAsAppendedOf } from '../event-appender.ts';
import type { AppendPlace, EncodedEvent } from '../event-store.ts';
import { refusedStreamOf } from '../refusals/append-refused.ts';
import { isVersionConflict, VersionConflict } from '../version-conflict.ts';
import type { AppendStreamRequest, MultiStreamAppends } from './multi-stream-appends.ts';
import { StreamRefused } from './stream-refused.ts';

export interface DecidedStreamAppend<Event extends Recorded> {
  readonly stream: string;
  readonly events: readonly Decided<Event>[];
  readonly place: AppendPlace;
}

export type MultiStreamAppender<Event extends Recorded> = (
  appends: readonly DecidedStreamAppend<Event>[],
) => Effect.Effect<void, VersionConflict | StreamRefused>;

function failedAppendOf(error: unknown): Effect.Effect<never, VersionConflict | StreamRefused> {
  if (isVersionConflict(error)) {
    return Effect.fail(new VersionConflict());
  }
  const refused = refusedStreamOf(error);
  return refused === undefined ? Effect.die(error) : Effect.fail(new StreamRefused(refused));
}

export function multiStreamAppenderOf<Event extends Recorded>(
  store: MultiStreamAppends,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): MultiStreamAppender<Event> {
  const eventAsAppended = eventAsAppendedOf(eventSchema);
  const requestOf = ({ stream, events, place }: DecidedStreamAppend<Event>): Effect.Effect<AppendStreamRequest> =>
    Effect.sync(() => checkedContext(place.context)).pipe(
      Effect.flatMap((context) =>
        Effect.map(
          Effect.forEach(events, (event) => eventAsAppended(event, context)),
          (encoded: readonly EncodedEvent[]) => ({ stream, events: encoded, place: { ...place, context } }),
        ),
      ),
    );
  return (appends) =>
    Effect.forEach(appends, requestOf).pipe(
      Effect.flatMap((requests: readonly AppendStreamRequest[]) =>
        Effect.tryPromise({ try: () => store.multiStreamAppend(requests), catch: (error) => error }),
      ),
      Effect.catch(failedAppendOf),
    );
}
