import { shapeIssues } from '@on.auto/json-schema';
import { Schema } from 'effect';

import { arrivalIssuesOf } from './arrival-checks.ts';
import {
  DestinationFieldsSchema,
  presenceIssuesOf,
  subscribesForEachPlace,
  type Destination,
  type DestinationIssue,
} from './destination-fields.ts';
import {
  answerIssuesOf,
  callIssuesOf,
  identityTemplates,
  placeNameTemplates,
  placesTheSubject,
  readsTheSubject,
  type Placed,
} from './event-calls.ts';
import { IdentitySchema } from './identity-call.ts';
import { pathOf } from './json-texts.ts';
import { PlaceNameSchema, type PlaceName } from './place-name-call.ts';
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

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const EventTypeFieldsSchema = Schema.Struct({
  type: NamedSchema.annotate({
    description:
      'The type of the event, as a trigger names it: the reverse domain name of whoever defines the event, followed by their name for it, as in com.example.invoice.paid.',
  }),
  title: NamedSchema.annotate({
    description: 'What happened, in a short sentence a person reads, such as "A message is posted".',
  }),
  subject: Schema.optionalKey(
    Schema.Struct({
      title: NamedSchema.annotate({
        description: 'What the service calls the place, such as "Channel" or "Repository".',
      }),
      required: Schema.Boolean.annotate({
        description:
          "Whether a trigger must name one place to listen in. Set it to true where a destination made per subscription writes this event's topic from subject.",
      }),
      description: Schema.optionalKey(
        NamedSchema.annotate({
          description:
            'How a trigger writes this place, and what must be true there for the service to report it, in a sentence or two an agent is given.',
        }),
      ),
      name: Schema.optionalKey(PlaceNameSchema),
    }).annotate({
      description: 'The place an event of this type happens in, such as a channel or a repository.',
    }),
  ),
  data: Schema.JsonObject.annotate({ description: 'The JSON Schema of the data an event of this type carries.' }),
});

type EventType = typeof EventTypeFieldsSchema.Type;

function dataIssuesOf({ data }: EventType): readonly DestinationIssue[] {
  return shapeIssues(data).map(({ pointer, detail }) => ({ path: ['data', ...pathOf(pointer)], issue: detail }));
}

const EventTypeSchema = EventTypeFieldsSchema.check(Schema.makeFilter(dataIssuesOf)).annotate({
  description: 'One kind of event the service reports.',
});

const EventsFieldsSchema = Schema.Struct({
  types: Schema.optionalKey(
    Schema.Array(EventTypeSchema).check(Schema.isMinLength(1)).annotate({
      description:
        'The kinds of events the service reports. Only a provider that ships with the runtime can declare them.',
    }),
  ),
  identity: Schema.optionalKey(IdentitySchema),
  destinations: Schema.Array(DestinationSchema).check(Schema.isMinLength(1)).annotate({
    description:
      'The ways the service sends what happens where a request waits, one of each type, in the order the runtime tries them, the first it can take serving',
  }),
});

type EventsFields = typeof EventsFieldsSchema.Type;

const oneOfEachEventType =
  'Expected a type that no earlier item of types declares, since each type of event is declared once';

const undeclaredType = 'Expected a type this entry declares under types';

const subjectToName =
  'Expected subject with required set to true, because a destination made per subscription writes the topic of this event from subject';

function declaredTypeIssuesOf(types: readonly EventType[]): readonly DestinationIssue[] {
  const named = types.map(({ type }) => type);
  return named.flatMap((type, index): readonly DestinationIssue[] =>
    named.indexOf(type) === index ? [] : [{ path: ['types', index, 'type'], issue: oneOfEachEventType }],
  );
}

function mappedTypeIssuesOf(types: readonly EventType[], destinations: readonly Destination[]) {
  const named = new Set(types.map(({ type }) => type));
  return destinations.flatMap((destination, index) =>
    (destination.events ?? []).flatMap((declared, each): readonly DestinationIssue[] =>
      named.has(declared.type)
        ? []
        : [{ path: ['destinations', index, 'events', each, 'type'], issue: undeclaredType }],
    ),
  );
}

function subjectIssuesOf(types: readonly EventType[], destinations: readonly Destination[]) {
  const placed = new Set(
    destinations
      .filter((destination) => subscribesForEachPlace(destination))
      .flatMap(({ events = [] }) =>
        events.filter(({ topic }) => topic !== undefined && readsTheSubject(topic)).map(({ type }) => type),
      ),
  );
  return types.flatMap(({ type, subject }, index): readonly DestinationIssue[] =>
    placed.has(type) && subject?.required !== true ? [{ path: ['types', index, 'subject'], issue: subjectToName }] : [],
  );
}

function issuesAt(placed: readonly Placed[]): readonly DestinationIssue[] {
  return placed.map(({ pointer, detail }) => ({ path: pathOf(pointer), issue: detail }));
}

const unplaced = 'Expected {{ subject }} in with, since the call reads the name of one place';

function nameIssuesOf(at: string, name: PlaceName): readonly Placed[] {
  return [
    ...callIssuesOf(at, name, placeNameTemplates),
    ...answerIssuesOf([[`${at}/named`, name.named]]),
    ...(placesTheSubject(name) ? [] : [{ pointer: `${at}/with`, detail: unplaced }]),
  ];
}

function placeNameIssuesOf(types: readonly EventType[]): readonly DestinationIssue[] {
  return types.flatMap(({ subject }, index) =>
    subject?.name === undefined ? [] : issuesAt(nameIssuesOf(`/types/${index}/subject/name`, subject.name)),
  );
}

type Identity = NonNullable<EventsFields['identity']>;

function identityIssuesOf(identity: Identity): readonly DestinationIssue[] {
  const { id, name } = identity.identified;
  return issuesAt([
    ...callIssuesOf('/identity', identity, identityTemplates),
    ...answerIssuesOf([
      ['/identity/identified/id', id],
      ['/identity/identified/name', name],
      ['/identity/account', identity.account],
    ]),
  ]);
}

const unidentified =
  'Expected identity under events, the call that asks which account the connection acts as, since actor is compared with that account';

function actorIssuesOf(destinations: readonly Destination[]): readonly DestinationIssue[] {
  return destinations.flatMap(({ events = [] }, index) =>
    events.flatMap(({ actor }, each): readonly DestinationIssue[] =>
      actor === undefined ? [] : [{ path: ['destinations', index, 'events', each, 'actor'], issue: unidentified }],
    ),
  );
}

function eventsIssuesOf({ types = [], identity, destinations }: EventsFields): readonly DestinationIssue[] {
  return [
    ...typeIssuesOf(destinations),
    ...declaredTypeIssuesOf(types),
    ...mappedTypeIssuesOf(types, destinations),
    ...subjectIssuesOf(types, destinations),
    ...placeNameIssuesOf(types),
    ...(identity === undefined ? actorIssuesOf(destinations) : identityIssuesOf(identity)),
  ];
}

export const EventsSchema = EventsFieldsSchema.check(Schema.makeFilter(eventsIssuesOf)).annotate({
  description:
    "How the service tells Auto that something changed where a request waits, so that Auto reads its replies at once: data alone, which makes Auto read through the reading it does, or, where a destination's filter says where, carries the reply itself. It also says which events the service reports.",
});

export type Events = typeof EventsSchema.Type;

type Call = NonNullable<Destination['unsubscribe']>;

function requestOriginOf(call: Call | undefined): readonly string[] {
  const url = call?.url === undefined ? null : URL.parse(call.url);
  return url === null ? [] : [url.origin];
}

export function requestOriginsOf({ events }: { readonly events?: Events | undefined }): readonly string[] {
  const calls = (events?.destinations ?? []).flatMap(({ subscribe, renew, unsubscribe, read }) => [
    subscribe,
    renew,
    unsubscribe,
    read,
  ]);
  return [...new Set([...calls, events?.identity].flatMap((call) => requestOriginOf(call)))];
}
