import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  ActedContextSchema,
  Conflict,
  EmittedContextSchema,
  factOf,
  recordedDecoder,
  type Context,
  type Decided,
  type Decider,
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

const publishedEvents = Buffer.from('e897efc8cb4b47b2b2ba2be1a76aeefb', 'hex');

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
  const hash = createHash('sha1')
    .update(publishedEvents)
    .update(JSON.stringify([source, id]), 'utf8')
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.toString('hex', 0, 16);
  return `events/${[hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')}`;
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
