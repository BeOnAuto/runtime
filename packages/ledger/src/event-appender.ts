import {
  checkedContext,
  recordingOf,
  type Conflict,
  type Context,
  type Decided,
  type Recorded,
} from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { measuredWhole, payloadsDeclaredBy } from './appends/payloads-declared.ts';
import type { ConnectionPorts } from './connection/ledger-connection.ts';
import type { Statement } from './connection/statement.ts';
import { eventCodecOf } from './event-codec.ts';
import type { AppendPlace, EncodedEvent, Streams } from './event-store.ts';
import { conflictOfARefusal } from './refusals/append-refused.ts';
import { isVersionConflict, VersionConflict } from './version-conflict.ts';

export type EventAppender<Event extends Recorded> = (
  stream: string,
  events: readonly Decided<Event>[],
  place: AppendPlace,
) => Effect.Effect<void, VersionConflict>;

export type EventAppenderWith<Event extends Recorded> = (
  stream: string,
  events: readonly Decided<Event>[],
  place: AppendPlace,
  statements: readonly Statement[],
) => Effect.Effect<void, VersionConflict>;

type RefusableAppender<Event extends Recorded> = (
  stream: string,
  events: readonly Decided<Event>[],
  place: AppendPlace,
) => Effect.Effect<void, VersionConflict | Conflict>;

type Appended = (encoded: readonly EncodedEvent[], place: AppendPlace) => Promise<void>;

type Appending<Event extends Recorded> = (
  stream: string,
  events: readonly Decided<Event>[],
  place: AppendPlace,
  appended: Appended,
) => Effect.Effect<void, VersionConflict | Conflict>;

type EventAsAppended<Event extends Recorded> = (event: Decided<Event>, context: Context) => Effect.Effect<EncodedEvent>;

function eventAsAppendedOf<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventAsAppended<Event> {
  const { encode } = eventCodecOf(eventSchema);
  const recorded = recordingOf(eventSchema);
  const declared = payloadsDeclaredBy(eventSchema);
  return (event, context) =>
    Effect.sync(() => recorded(event, context)).pipe(
      Effect.flatMap(encode),
      Effect.map((encoded) => measuredWhole(declared, encoded)),
    );
}

function failedAppendOf(error: unknown): Effect.Effect<never, VersionConflict | Conflict> {
  if (isVersionConflict(error)) {
    return Effect.fail(new VersionConflict());
  }
  const refused = conflictOfARefusal(error);
  return refused === undefined ? Effect.die(error) : Effect.fail(refused);
}

function appendingOf<Event extends Recorded>(
  mostEventsInOneAppend: number,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): Appending<Event> {
  const eventAsAppended = eventAsAppendedOf(eventSchema);
  return (stream, events, place, appended) => {
    if (events.length > mostEventsInOneAppend) {
      return Effect.die(
        new RangeError(`A decision on ${stream} gave ${events.length} events, more than ${mostEventsInOneAppend}`),
      );
    }
    return Effect.sync(() => checkedContext(place.context)).pipe(
      Effect.flatMap((context) =>
        Effect.forEach(events, (event) => eventAsAppended(event, context)).pipe(
          Effect.flatMap((encoded: readonly EncodedEvent[]) =>
            Effect.tryPromise({
              try: () => appended(encoded, { ...place, context }),
              catch: (error) => error,
            }),
          ),
        ),
      ),
      Effect.catch(failedAppendOf),
    );
  };
}

export function refusableAppenderOf<Event extends Recorded>(
  store: Pick<Streams, 'mostEventsInOneAppend' | 'append'>,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): RefusableAppender<Event> {
  const appending = appendingOf(store.mostEventsInOneAppend, eventSchema);
  return (stream, events, place) =>
    appending(stream, events, place, (encoded, placed) => store.append(stream, encoded, placed));
}

export function eventAppenderOf<Event extends Recorded>(
  store: Pick<Streams, 'mostEventsInOneAppend' | 'append'>,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventAppender<Event> {
  const append = refusableAppenderOf(store, eventSchema);
  return (stream, events, place) => append(stream, events, place).pipe(Effect.catchTag('conflict', Effect.die));
}

export function eventAppenderWithOf<Event extends Recorded>(
  { streams, appendWith }: Pick<ConnectionPorts, 'streams' | 'appendWith'>,
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
): EventAppenderWith<Event> {
  const appending = appendingOf(streams.mostEventsInOneAppend, eventSchema);
  return (stream, events, place, statements) =>
    appending(stream, events, place, (encoded, placed) => appendWith(stream, encoded, placed, statements)).pipe(
      Effect.catchTag('conflict', Effect.die),
    );
}
