import { Schema } from 'effect';

const ConditionsSchema = Schema.Record(Schema.String, Schema.Array(Schema.String).check(Schema.isMinLength(1)));

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
    "Where a delivery carries the person's reply, each in its body, so that Auto takes the reply as it arrives, by the rule a reading takes one by: only where verify proves every byte of the body and a time and connection names the account, and only in an entry the runtime ships",
});

export const FilterSchema = Schema.Struct({
  when: ConditionsSchema.annotate({
    description:
      'The arrivals that make Auto read now: each a runtime expression, a header or a field, with the values it may equal, every one of which holds',
  }),
  subscription: Schema.optionalKey(
    Schema.String.annotate({
      description:
        'Per subscription, where an arrival names the subscription it is for, so that only the conversations waiting through that subscription are read',
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
