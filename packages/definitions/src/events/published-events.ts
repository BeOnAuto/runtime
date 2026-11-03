import {
  ActedContextSchema,
  Conflict,
  EmittedContextSchema,
  factOf,
  recordedDecoder,
  type Context,
  type Decided,
  type Decider,
  uuidV5,
} from '@on.auto/operations';
import { Effect, Equal, Option, Result, Schema } from 'effect';

import { CloudEventSchema, type CloudEvent } from './cloud-event.ts';
import { instantOf } from './event-time.ts';

const FilledAttributeSchema = Schema.Literals(['id', 'time']);

export type FilledAttribute = typeof FilledAttributeSchema.Type;

const EmitterSchema = Schema.Struct({
  run_id: Schema.String,
  workflow: Schema.String,
  version: Schema.Int,
});

export type Emitter = typeof EmitterSchema.Type;

const PublishedByACallerContextSchema = Schema.Struct({
  ...ActedContextSchema.fields,
  runId: Schema.optionalKey(Schema.Never),
});

export const EventPublishedSchema = factOf(
  'event_published',
  Schema.Struct({ event: CloudEventSchema, filled: Schema.Array(FilledAttributeSchema) }),
  Schema.Union([EmittedContextSchema, PublishedByACallerContextSchema]),
);

export type RecordedEventPublished = typeof EventPublishedSchema.Type;

export type EventPublished = Decided<RecordedEventPublished>;

export interface PublishEvent {
  readonly event: CloudEvent;
  readonly filled: readonly FilledAttribute[];
  readonly emittedBy?: Emitter;
  readonly depth?: number;
  readonly by: string;
  readonly at: string;
}

export type PublishedEventState = RecordedEventPublished | undefined;

const publishedEvents = 'e897efc8-cb4b-47b2-b2ba-2be1a76aeefb';

const anotherEvent = new Conflict({
  detail: 'Another event was published with this source and id; give a different event an id of its own',
});

function given(event: CloudEvent, filled: ReadonlySet<string>): Schema.JsonObject {
  const attributes = Object.fromEntries(
    Object.entries(event).filter(([attribute]: readonly [string, Schema.Json]) => !filled.has(attribute)),
  );
  return filled.has('time') ? attributes : { ...attributes, time: instantOf(event.time) };
}

function isSameEvent({ data }: RecordedEventPublished, { event, filled }: PublishEvent): boolean {
  const filledOnEitherSide = new Set([...data.filled, ...filled]);
  return Equal.equals(given(data.event, filledOnEitherSide), given(event, filledOnEitherSide));
}

function decideOnPublishing(
  publish: PublishEvent,
  published: PublishedEventState,
): Result.Result<readonly EventPublished[], Conflict> {
  if (published === undefined) {
    const { event, filled } = publish;
    return Result.succeed([{ type: 'event_published', data: { event, filled } }]);
  }
  return isSameEvent(published, publish) ? Result.succeed([]) : Result.fail(anotherEvent);
}

function emitterContextOf(
  emitter: Emitter | undefined,
): Pick<Context, 'runId' | 'definitionType' | 'definitionName' | 'definitionVersion'> {
  return emitter === undefined
    ? {}
    : {
        runId: emitter.run_id,
        definitionType: 'workflow',
        definitionName: emitter.workflow,
        definitionVersion: emitter.version,
      };
}

function publicationContextOf({ emittedBy, depth, by, at }: PublishEvent): Context {
  return { at, by, ...emitterContextOf(emittedBy), ...(depth === undefined ? {} : { depth }) };
}

export const publishedEventDecider: Decider<PublishedEventState, PublishEvent, RecordedEventPublished, 'conflict'> = {
  initialState: undefined,
  evolve: (_earlier, published) => published,
  decide: decideOnPublishing,
  context: publicationContextOf,
  eventSchema: EventPublishedSchema,
};

export function publishedEventStreamOf(source: string, id: string): string {
  return `events/${uuidV5(publishedEvents, JSON.stringify([source, id]))}`;
}

export function recordedPublication(state: PublishedEventState): Effect.Effect<RecordedEventPublished> {
  return state === undefined
    ? Effect.die(new Error('The stream of a published event holds no event once it is published'))
    : Effect.succeed(state);
}

const decodePublished = recordedDecoder(EventPublishedSchema);

export function publishedEventOf(recorded: unknown): RecordedEventPublished | undefined {
  return Option.getOrUndefined(decodePublished(recorded));
}
