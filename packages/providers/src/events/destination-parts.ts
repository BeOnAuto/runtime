import { Schema } from 'effect';

const ConditionsSchema = Schema.Record(
  Schema.String,
  Schema.Array(Schema.NullOr(Schema.String)).check(Schema.isMinLength(1)),
);

const DeliveredReplySchema = Schema.Struct({
  id: Schema.String.annotate({
    description:
      'Where a delivery names the identity of the reply, the one a reading of the conversation lists it by, so that a reply is taken once however often it arrives',
  }),
  sender: Schema.String.annotate({
    description:
      'Where a delivery names who wrote the reply, so that only the person a request waits for can answer it',
  }),
  text: Schema.String.annotate({ description: "Where a delivery holds the reply's words" }),
  to: Schema.String.annotate({
    description:
      "Where a delivery names the message the reply answers, as sent.id names a request's message, so that only the request sent as that message can take it",
  }),
  time: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Where a delivery names when the reply was written, in seconds since the epoch or as an RFC 3339 date-time; it orders the replies that arrive together and decides nothing else',
    }),
  ),
  changed: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Where a delivery holds something only when it is no new message, such as an edit, a deletion or a notice, which then carries no reply and only makes Auto read',
    }),
  ),
}).annotate({
  description:
    "Where a delivery holds the person's reply, so that Auto takes the reply as it arrives, without reading the conversation first. Only an entry that ships with the runtime can declare it: in a provider added in the configuration file it is refused.",
});

export const FilterSchema = Schema.Struct({
  when: ConditionsSchema.annotate({
    description:
      'The arrivals that make Auto read now: each a runtime expression, a header or a field, with the values it may equal, every one of which holds. Put null among the values to let a header or field that is missing or null pass',
  }),
  subscription: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Per subscription, where an arrival names the subscription it is for; unlike conversation, it does not narrow which conversations are read',
    }),
  ),
  conversation: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Where an arrival names the conversation it is about, as the answer of a request's delivery names it in sent.conversation, so that only the conversations waiting there are read",
    }),
  ),
  automatic: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Where an arrival holds something only when an app posted the message it is about, which then makes Auto read nothing, as the automatic of conversations passes such a message over',
    }),
  ),
  reply: Schema.optionalKey(DeliveredReplySchema),
}).annotate({ description: 'Which arrivals make Auto read the conversations that wait, through the reading it does' });

const ExpressionSchema = Schema.String;

const WhereItAppliesSchema = Schema.Union([ExpressionSchema, ConditionsSchema]);

export const EventMappingSchema = Schema.Struct({
  type: Schema.String.annotate({
    description: 'The type of event such a delivery is. It must be one of the types declared under types.',
  }),
  when: ConditionsSchema.annotate({
    description:
      'Which deliveries are this event. Each key is a runtime expression into a field of the delivery, and its value lists the values that field may equal. Every condition must hold. Put null in a list to let a field that is missing or null pass.',
  }),
  id: Schema.Array(ExpressionSchema).check(Schema.isMinLength(1)).annotate({
    description:
      "Where a delivery holds the event's ID, as one or more runtime expressions whose values are unique together. A delivery is this event only where each of them holds text or a number, so an event the service sends twice has the same ID both times.",
  }),
  time: Schema.optionalKey(
    ExpressionSchema.annotate({
      description:
        'Where a delivery says when the event happened, in seconds since the epoch or as an RFC 3339 date-time.',
    }),
  ),
  subject: Schema.optionalKey(
    ExpressionSchema.annotate({ description: 'Where a delivery names the place the event happened in.' }),
  ),
  data: Schema.optionalKey(
    Schema.Record(Schema.String, ExpressionSchema).annotate({
      description: "Where a delivery holds each field of the event's data, by the field's name.",
    }),
  ),
  automatic: Schema.optionalKey(
    WhereItAppliesSchema.annotate({
      description:
        'How to tell that an app or a bot did what a delivery reports: a runtime expression into a field that holds a value only then, or conditions written like those in when. Such an event is marked as one an app or a bot caused.',
    }),
  ),
  changed: Schema.optionalKey(
    WhereItAppliesSchema.annotate({
      description:
        'How to tell that a delivery reports no new item, such as an edit, a deletion or a notice: a runtime expression into a field that holds a value only then, or conditions written like those in when. Such a delivery is not an event.',
    }),
  ),
  actor: Schema.optionalKey(
    ExpressionSchema.annotate({
      description:
        'Where a delivery names the account that did what it reports, as a runtime expression. It must give the same value as the id that identity answers for that account, so that the two can be compared.',
    }),
  ),
  own: Schema.optionalKey(
    Schema.Tuple([ExpressionSchema, ExpressionSchema]).annotate({
      description:
        'Two runtime expressions: the field that names the account that did what a delivery reports, and the field that names the account the connection acts as. Where both name the same account, the connection did it itself, and the delivery is not an event.',
    }),
  ),
  topic: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The topic Auto subscribes to for this event in one place, as a Liquid template that reads subject, the place the event happens in. It must render the same topic as the destination's own topic renders for a request waiting in that place. Each event of a destination made per subscription needs one, and no other event takes one.",
    }),
  ),
}).annotate({
  description:
    "One kind of delivery that is an event, and the fields of the delivery that hold the event's ID, time, place and data.",
});

export const ChatMappingSchema = Schema.Struct({
  kind: Schema.Literals(['mention', 'direct_message', 'ambient']).annotate({
    description:
      'What kind of message it is: mention, a message that names the app; direct_message, a message written to the app alone; ambient, a message the app can read that does not name it. Auto takes an ambient message only where it is a reply in a thread.',
  }),
  when: ConditionsSchema.annotate({
    description:
      'Which deliveries are a message of this kind. Each key is a runtime expression into a field of the delivery, and its value lists the values that field may equal. Every condition must hold. Put null in a list to let a field that is missing or null pass.',
  }),
  id: ExpressionSchema.annotate({
    description: "Where a delivery holds the message's ID within its conversation, as a runtime expression.",
  }),
  conversation: ExpressionSchema.annotate({
    description: 'Where a delivery names the conversation the message was written in, such as a channel.',
  }),
  thread: Schema.optionalKey(
    ExpressionSchema.annotate({
      description:
        'Where a delivery names the first message of the thread the message was written in, when it was written in one.',
    }),
  ),
  sender: ExpressionSchema.annotate({ description: 'Where a delivery names the person who wrote the message.' }),
  account: Schema.optionalKey(
    Schema.Array(ExpressionSchema).check(Schema.isMinLength(1)).annotate({
      description:
        'Where a delivery names the account of the person who wrote the message, such as their workspace: one or more runtime expressions, read in order, the first that holds text naming it.',
    }),
  ),
  text: ExpressionSchema.annotate({ description: 'Where a delivery holds the words of the message.' }),
  time: Schema.optionalKey(
    ExpressionSchema.annotate({
      description:
        'Where a delivery says when the message was written, in seconds since the epoch or as an RFC 3339 date-time.',
    }),
  ),
  automatic: Schema.optionalKey(
    WhereItAppliesSchema.annotate({
      description:
        'How to tell that an app or a bot wrote the message: a runtime expression into a field that holds a value only then, or conditions written like those in when. Such a delivery is no message a person wrote.',
    }),
  ),
  changed: Schema.optionalKey(
    WhereItAppliesSchema.annotate({
      description:
        'How to tell that a delivery reports no new message, such as an edit or a deletion: a runtime expression into a field that holds a value only then, or conditions written like those in when. Such a delivery is no message.',
    }),
  ),
  shared: Schema.optionalKey(
    ExpressionSchema.annotate({
      description:
        'Where a delivery says whether the conversation is shared with another organization, as a runtime expression into a field that is false where it is not. Where the field is missing, the conversation is taken as shared.',
    }),
  ),
}).annotate({
  description:
    'One kind of message a person writes where the app reads, and the fields of the delivery that hold the message.',
});

export const HandshakeSchema = Schema.Struct({
  when: ConditionsSchema.annotate({
    description: 'The arrival with which the service checks the address, as filter.when names an arrival',
  }),
  challenge: Schema.String.annotate({ description: 'Where the challenge the runtime answers is' }),
  response: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Literals(['challenge', 'hmac'])).annotate({
      description:
        "The fields of a JSON answer, each the challenge as it came or its hmac under the destination's secret, by the hash and encoding of its proof; left out, the challenge alone is answered as text",
    }),
  ),
  signed: Schema.Boolean.annotate({
    description:
      "Whether the service proves the handshake as it proves a delivery, so that it is answered once proven; false where it comes before any secret exists, as WebSub's verification of intent does",
  }),
}).annotate({ description: 'How the service checks the address before it sends, as WebSub verifies intent' });

export const ConnectionSchema = Schema.Struct({
  account: Schema.String.annotate({
    description:
      "Where an arrival names the vendor's account it happened in, such as a workspace, so that Auto finds the connections made in it",
  }),
  user: Schema.optionalKey(
    Schema.String.annotate({
      description: "Where an arrival names the vendor's user it is for, where the service sends for each person",
    }),
  ),
}).annotate({ description: 'For a destination of the app, where an arrival names whose connection it is for' });

export const OpenSchema = Schema.Struct({
  method: Schema.Literals(['GET', 'POST']).annotate({
    description:
      "The method of the HTTPS request that answers the socket's address, carrying the app's credential as a bearer token",
  }),
  url: Schema.String.annotate({ description: 'The https URL of that request, written out whole' }),
  address: Schema.String.annotate({
    description: "A JSON Pointer into what the request answers, to the socket's wss address",
  }),
}).annotate({ description: 'How the runtime finds the address of the socket it opens' });
