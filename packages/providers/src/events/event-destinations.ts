import { Schema } from 'effect';

import { arrivalIssuesOf } from './arrival-checks.ts';
import {
  DestinationFieldsSchema,
  presenceIssuesOf,
  type Destination,
  type DestinationIssue,
} from './destination-fields.ts';
import { subscriptionIssuesOf } from './subscription-checks.ts';

const DestinationSchema = DestinationFieldsSchema.check(
  Schema.makeFilter((destination: Destination) => [
    ...presenceIssuesOf(destination),
    ...arrivalIssuesOf(destination),
    ...subscriptionIssuesOf(destination),
  ]),
).annotate({ description: 'One way the service sends' });

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
    'How the service tells Auto that something changed where a request waits, so that Auto reads its replies at once: data alone, which only makes Auto read through the reading it does',
});

export type Events = typeof EventsSchema.Type;
