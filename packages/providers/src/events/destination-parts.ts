import { Schema } from 'effect';

const ConditionsSchema = Schema.Record(Schema.String, Schema.Array(Schema.String).check(Schema.isMinLength(1)));

export const WakeSchema = Schema.Struct({
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
}).annotate({ description: 'Which arrivals make Auto read the conversations that wait, through the reading it does' });

export const HandshakeSchema = Schema.Struct({
  when: ConditionsSchema.annotate({
    description: 'The arrival with which the service checks the address, as wake.when names an arrival',
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
  tool: Schema.optionalKey(
    Schema.String.annotate({
      description: "A tool of the connection that answers the socket's address, named as the server lists it",
    }),
  ),
  address: Schema.optionalKey(
    Schema.String.annotate({ description: "Beside tool, a JSON Pointer into its answer, to the socket's address" }),
  ),
  url: Schema.optionalKey(Schema.String.annotate({ description: "The socket's wss address, written out whole" })),
}).annotate({ description: 'How the runtime finds the address of the socket it opens' });
