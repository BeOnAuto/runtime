import { ContextReference } from '@on.auto/operations';
import { Schema } from 'effect';

const referenceWords = 'Where the document names it, as a JSON pointer, which no later version renumbers';

const ReferenceField = Schema.String.annotate({ description: referenceWords });

const TriggerReferenceField = ContextReference.annotate({ description: referenceWords });

const TriggerFilterSchema = Schema.Struct({
  reference: ReferenceField,
  type: Schema.String.annotate({ description: 'The type of the events the filter takes' }),
  attributes: Schema.JsonObject.annotate({
    description: 'What an event must have to match, as written: its type, and its source, subject and data when named',
  }),
});

export const EventTriggerSchema = Schema.Struct({
  kind: Schema.Literal('event'),
  reference: TriggerReferenceField,
  filters: Schema.Array(TriggerFilterSchema).annotate({
    description: 'The filters of the events that start a run; an event that any of them matches starts one',
  }),
});

const universalTime = 'UTC';

const CronTriggerSchema = Schema.Struct({
  kind: Schema.Literal('cron'),
  reference: TriggerReferenceField,
  expression: Schema.String.annotate({ description: 'The five fields of its times, read in its time zone' }),
  time_zone: Schema.optionalKey(
    Schema.String.annotate({
      description: `Its time zone, an IANA time zone name such as America/New_York; left out, ${universalTime}`,
    }),
  ),
});

const EveryTriggerSchema = Schema.Struct({
  kind: Schema.Literal('every'),
  reference: TriggerReferenceField,
  milliseconds: Schema.Int.annotate({ description: 'Its period, counted from when the trigger was saved as it is' }),
});

export const ScheduleTriggerSchema = Schema.Union([CronTriggerSchema, EveryTriggerSchema]);

export const TriggerSchema = Schema.Union([EventTriggerSchema, CronTriggerSchema, EveryTriggerSchema]).annotate({
  description: 'A condition that starts a run on its own: an event trigger, or a cron or every schedule',
});

export type Trigger = typeof TriggerSchema.Type;

export type EventTrigger = Extract<Trigger, { readonly kind: 'event' }>;

export type ScheduleTrigger = Exclude<Trigger, EventTrigger>;

export type CronTrigger = Extract<Trigger, { readonly kind: 'cron' }>;

export type TriggerFilter = EventTrigger['filters'][number];

export function timeZoneOf({ time_zone: timeZone = universalTime }: CronTrigger): string {
  return timeZone;
}

export function hasTriggers({ triggers }: { readonly triggers?: readonly Trigger[] }): boolean {
  return triggers !== undefined && triggers.length > 0;
}
