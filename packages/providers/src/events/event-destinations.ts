import { Schema } from 'effect';

import { arrivalIssuesOf } from './arrival-checks.ts';
import {
  DestinationFieldsSchema,
  presenceIssuesOf,
  type Destination,
  type DestinationIssue,
} from './destination-fields.ts';
import { subscriptionIssuesOf } from './subscription-checks.ts';

export function destinationIssuesOf(destination: Destination): readonly DestinationIssue[] {
  return [...presenceIssuesOf(destination), ...arrivalIssuesOf(destination), ...subscriptionIssuesOf(destination)];
}

const DestinationSchema = DestinationFieldsSchema.check(Schema.makeFilter(destinationIssuesOf)).annotate({
  description: 'One way the service sends',
});

const oneOfEachType =
  'Expected a type no earlier destination has, since an entry takes one destination of each type, in the order to try them';

function typeIssuesOf(destinations: readonly Destination[]): readonly DestinationIssue[] {
  const types = destinations.map(({ type }) => type);
  return types.flatMap((type, index): readonly DestinationIssue[] =>
    types.indexOf(type) === index ? [] : [{ path: ['destinations', index, 'type'], issue: oneOfEachType }],
  );
}

const EventsFieldsSchema = Schema.Struct({
  destinations: Schema.Array(DestinationSchema).check(Schema.isMinLength(1)).annotate({
    description:
      'The ways the service sends what happens where a request waits, one of each type, in the order the runtime tries them, the first it can take serving',
  }),
});

export const EventsSchema = EventsFieldsSchema.check(
  Schema.makeFilter(({ destinations }: typeof EventsFieldsSchema.Type) => typeIssuesOf(destinations)),
).annotate({
  description:
    "How the service tells Auto that something changed where a request waits, so that Auto reads its replies at once: data alone, which makes Auto read through the reading it does, or, where a destination's filter says where, carries the reply itself",
});

export type Events = typeof EventsSchema.Type;

type Call = NonNullable<Destination['unsubscribe']>;

function requestOriginOf(call: Call | undefined): readonly string[] {
  const url = call?.url === undefined ? null : URL.parse(call.url);
  return url === null ? [] : [url.origin];
}

export function requestOriginsOf({ events }: { readonly events?: Events | undefined }): readonly string[] {
  const calls = (events?.destinations ?? []).flatMap(({ subscribe, renew, unsubscribe }) => [
    subscribe,
    renew,
    unsubscribe,
  ]);
  return [...new Set(calls.flatMap((call) => requestOriginOf(call)))];
}
