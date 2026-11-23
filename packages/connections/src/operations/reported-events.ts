import { providerFoundBy, type ProviderList } from '@on.auto/providers';
import { Schema } from 'effect';

import type { Connection } from '../registry/connection.ts';
import { hearingOf, nothingReceived, speedOf, type EventsReceived } from '../triggers/connection-hearing.ts';

const connectionSourcePrefix = '/connections/';

const ListedSubjectSchema = Schema.Struct({
  title: Schema.String,
  required: Schema.Boolean,
  description: Schema.optionalKey(Schema.String),
}).annotate({
  description:
    "The place the event happens in, such as a channel: what it is called, whether the filter must name one, and how to write it as the filter's `subject`.",
});

const ListedEventTypeSchema = Schema.Struct({
  type: Schema.String.annotate({ description: "Write this as the filter's `type`." }),
  title: Schema.String.annotate({ description: 'What happened, in words to say to the person' }),
  subject: Schema.optionalKey(ListedSubjectSchema),
  speed: Schema.Literals(['instant', 'polling']).annotate({
    description:
      '`instant` when the workflow starts as it happens. `polling` when Auto checks the app on a timer and starts the workflow for what is new since its last check.',
  }),
  polling_interval_seconds: Schema.optionalKey(
    Schema.Int.annotate({
      description:
        'How often Auto checks the app, in seconds, when `speed` is `polling`. Say it to the person as a pace, such as about every minute.',
    }),
  ),
  data: Schema.JsonObject.annotate({
    description: "The JSON Schema of the event's `data`, for a condition on what happened",
  }),
});

type ListedEventType = typeof ListedEventTypeSchema.Type;

type ListedSubject = typeof ListedSubjectSchema.Type;

export const reportedEventsFields = {
  source: Schema.String.annotate({
    description: "Write this as the `source` of a trigger's filter to start a workflow from this connection's events.",
  }),
  event_types: Schema.Array(ListedEventTypeSchema).annotate({
    description:
      'The events this connection reports, each of which can start a workflow. The list is empty when it reports none or is not connected.',
  }),
};

export interface ReportedEvents {
  readonly source: string;
  readonly event_types: readonly ListedEventType[];
}

type Reporting = Pick<Connection, 'name' | 'provider' | 'status' | 'app_credentials'>;

function listedSubjectOf({ title, required, description }: ListedSubject): ListedSubject {
  return { title, required, ...(description === undefined ? {} : { description }) };
}

function eventTypesOf(
  connection: Reporting,
  providers: ProviderList,
  received: EventsReceived,
): readonly ListedEventType[] {
  const entry = providerFoundBy(providers, connection.provider)?.entry;
  if (entry === undefined || connection.status !== 'connected') {
    return [];
  }
  return (entry.events?.types ?? []).flatMap(({ type, title, subject, data }) => {
    const hearing = hearingOf(connection, entry, received, type);
    return hearing.kind === 'not_heard'
      ? []
      : [
          {
            type,
            title,
            ...(subject === undefined ? {} : { subject: listedSubjectOf(subject) }),
            ...speedOf(hearing),
            data,
          },
        ];
  });
}

export function reportedEventsOf(
  connection: Reporting,
  providers: ProviderList,
  received: EventsReceived = nothingReceived,
): ReportedEvents {
  return {
    source: `${connectionSourcePrefix}${connection.name}`,
    event_types: eventTypesOf(connection, providers, received),
  };
}
