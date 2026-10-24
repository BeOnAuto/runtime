import { Schema } from 'effect';

export const mostPublicEventDataBytes = 4096;

export const mostShownFieldBytes = 2048;

export const mostToolFieldBytes = 65_536;

const utf8 = new TextEncoder();

function fitsInPublicEventData(data: Schema.JsonObject): boolean {
  return utf8.encode(JSON.stringify(data)).byteLength <= mostPublicEventDataBytes;
}

const EventDefinitionSchema = Schema.Struct({
  type: Schema.String.annotate({ description: 'Its type' }),
  name: Schema.String.annotate({ description: 'Its name' }),
  version: Schema.optionalKey(Schema.Int.annotate({ description: 'Its version, where the fact names one' })),
}).annotate({ description: 'The definition the run executes, or the definition the event is about' });

const EventCalledBySchema = Schema.Struct({
  run_id: Schema.String.annotate({ description: 'The id of the run whose call started this run' }),
  reference: Schema.String.annotate({ description: 'Where in that run the call is' }),
  run: Schema.Int.annotate({ description: 'Which run of that call this is, from 1' }),
}).annotate({ description: 'The call this run answers' });

const EventTriggerSchema = Schema.Struct({
  kind: Schema.String.annotate({ description: 'event, cron or every' }),
  reference: Schema.String.annotate({ description: 'Where in the definition the trigger is' }),
}).annotate({ description: 'The trigger that started the run' });

export const EventMetadataSchema = Schema.Struct({
  stream: Schema.String.annotate({ description: 'The stream the event is recorded in' }),
  position: Schema.Int.annotate({ description: "The event's number in its stream, from 1" }),
  global_position: Schema.Int.annotate({
    description: "The store's sequence across every playbook, with gaps, which is not the order events are read in",
  }),
  correlation_id: Schema.NullOr(Schema.String).annotate({
    description: 'The id of the run at the top of the chain the event belongs to, or null',
  }),
  causation_id: Schema.NullOr(Schema.String).annotate({
    description: 'The id of the event that directly led to this one, or null when nothing recorded did',
  }),
  at: Schema.String.annotate({ description: 'When it happened, by its own clock, in ISO 8601 UTC' }),
  by: Schema.String.annotate({
    description: "Who acted: a caller's id, or playbook:<playbook> for the playbook's own work",
  }),
  run_id: Schema.optionalKey(Schema.String.annotate({ description: 'The run the event belongs to' })),
  definition: Schema.optionalKey(EventDefinitionSchema),
  called_by: Schema.optionalKey(EventCalledBySchema),
  call_depth: Schema.optionalKey(Schema.Int.annotate({ description: 'How many calls are above the run' })),
  depth: Schema.optionalKey(Schema.Int.annotate({ description: 'How many reactions are above the run or event' })),
  trigger: Schema.optionalKey(EventTriggerSchema),
  trace_id: Schema.optionalKey(Schema.String.annotate({ description: 'The trace of the append that recorded it' })),
  span_id: Schema.optionalKey(Schema.String.annotate({ description: 'The span of the append that recorded it' })),
}).annotate({ description: 'Where the event is recorded, and who, when, which run and which chain it belongs to' });

export type EventMetadata = typeof EventMetadataSchema.Type;

const eventFields = {
  id: Schema.String.annotate({
    description:
      "The id of the event, the same on every read; a workflow's step is its record's id, an underscore and its number",
  }),
  type: Schema.String.annotate({ description: 'What kind of event it is, a stable public name' }),
  summary: Schema.String.annotate({ description: 'What happened, in plain words' }),
};

export const PublicEventSchema = Schema.Struct({
  ...eventFields,
  data: Schema.JsonObject.annotate({
    description: `The fact, at most ${mostPublicEventDataBytes} bytes as JSON in UTF-8, with an input, output, record, answer, arguments, data, messages, response or tool_calls past ${mostShownFieldBytes} bytes as its size`,
  }).check(
    Schema.makeFilter(fitsInPublicEventData, {
      expected: `data of at most ${mostPublicEventDataBytes} bytes as JSON in UTF-8`,
    }),
  ),
  metadata: EventMetadataSchema,
}).annotate({
  identifier: 'PublicEvent',
  description: 'Something that happened in the playbook, as a caller reads it',
});

export const WholeEventSchema = Schema.Struct({
  ...eventFields,
  data: Schema.JsonObject.annotate({
    description: `The fact with its fields whole; over MCP, an input, output, record, answer, arguments, result or data past ${mostToolFieldBytes} bytes appears as its size`,
  }),
  metadata: EventMetadataSchema,
}).annotate({ identifier: 'WholeEvent', description: 'One event of the playbook, read whole' });

export type PublicEvent = typeof PublicEventSchema.Type;
