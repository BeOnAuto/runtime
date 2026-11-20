import { Schema, SchemaTransformation } from 'effect';

import { DestinationFieldsSchema } from './destination-fields.ts';
import { destinationIssuesOf } from './event-destinations.ts';
import { credentialsHeldIn } from './event-entries.ts';
import { narrowedIssuesIn } from './hand-narrowing.ts';

const oneDestination = 'Expected exactly one destination: write one item in destinations';

const heldCredential =
  'Looks like a credential, which events never holds: remove it. Write {{ secret }} where the subscribe call takes the webhook secret, and Auto fills it in. If the service makes that secret, point subscribed.secret at it in what the call returns';

const callsOfASubscription = ['subscribe', 'renew', 'unsubscribe'] as const;

const EventsByHandFieldsSchema = Schema.Struct({
  destinations: Schema.Array(DestinationFieldsSchema.check(Schema.makeFilter(destinationIssuesOf))).check(
    Schema.isMinLength(1, { message: oneDestination }),
    Schema.isMaxLength(1, { message: oneDestination }),
  ),
});

export type EventsByHand = typeof EventsByHandFieldsSchema.Type;

export const EventsByHandSchema = Schema.Record(Schema.String, Schema.Json)
  .check(Schema.makeFilter(narrowedIssuesIn))
  .pipe(
    Schema.decodeTo(
      EventsByHandFieldsSchema.check(
        Schema.makeFilter((events: EventsByHand) => credentialsHeldIn(events, '', heldCredential)),
      ),
      SchemaTransformation.passthroughSupertype(),
    ),
  );

export const RecordedEventsSchema = Schema.Struct({
  destinations: Schema.Array(Schema.Record(Schema.String, Schema.Json)),
});

export type RecordedEvents = typeof RecordedEventsSchema.Type;

interface ToolNamed {
  readonly path: readonly [string, number, string, string];
  readonly tool: string;
}

export function toolsNamedIn({ destinations }: EventsByHand): readonly ToolNamed[] {
  return destinations.flatMap((destination, index) =>
    callsOfASubscription.flatMap((call): readonly ToolNamed[] => {
      const tool = destination[call]?.tool;
      return tool === undefined ? [] : [{ path: ['destinations', index, call, 'tool'], tool }];
    }),
  );
}
