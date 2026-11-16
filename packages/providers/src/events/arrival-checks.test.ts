import { describe, expect, it } from 'vitest';

import {
  aReply,
  carrying,
  firstDestination as destination,
  ofEachSubscription,
  ofTheApp,
  overASocket,
  sentBy,
  without,
} from '../testing/event-destinations.ts';

const ofTheRequest =
  'Expected $request.header.<name>, $request.query.<name>, or $request.body#/<pointer>, a runtime expression of OpenAPI into the request';

const ofTheMessage =
  'Expected $message.header#/<pointer> or $message.payload#/<pointer>, a runtime expression of AsyncAPI into the message';

const noConditions = 'Expected at least one runtime expression with the values it may equal';

function opened(open: unknown) {
  return sentBy({ ...overASocket, open });
}

const notWholeAddress = "Expected a wss URL written out whole, the address of the service's socket";

describe('where a request delivered to a webhook says what it is about', () => {
  it('is a runtime expression of OpenAPI into the request', () => {
    const wake = {
      when: {
        '$request.header.X Event': ['comment'],
        '$request.header.X(Event)': ['comment'],
        '$request.body': ['comment'],
        '$message.payload#/type': ['comment'],
        '$request.query.kind': ['comment'],
      },
      conversation: '$request.body#/event~2/channel',
      automatic: 'event.bot_id',
    };
    const connection = { account: '$request.path.team', user: '$request.body#/user' };

    expect(sentBy({ ...ofTheApp, wake, connection })).toEqual([
      [`${destination}/wake/when/$request.header.X Event`, ofTheRequest],
      [`${destination}/wake/when/$request.header.X(Event)`, ofTheRequest],
      [`${destination}/wake/when/$request.body`, ofTheRequest],
      [`${destination}/wake/when/$message.payload#/type`, ofTheRequest],
      [`${destination}/wake/conversation`, ofTheRequest],
      [`${destination}/wake/automatic`, ofTheRequest],
      [`${destination}/connection/account`, ofTheRequest],
    ]);
  });

  it('holds one condition at least, each with one value at least', () => {
    expect(sentBy({ ...ofTheApp, wake: { when: {} } })).toEqual([[`${destination}/wake/when`, noConditions]]);
    expect(sentBy({ ...ofTheApp, wake: { when: { '$request.body#/type': [] } } })).toMatchObject([
      [`${destination}/wake/when/$request.body#/type`, expect.any(String)],
    ]);
  });

  it('names the subscription only in an arrival of a destination per subscription', () => {
    expect(sentBy({ ...ofTheApp, wake: { ...ofTheApp.wake, subscription: '$request.header.X-Hook' } })).toEqual([
      [
        `${destination}/wake/subscription`,
        'Expected subscription only in the wake of a destination per subscription, whose arrivals name the subscription Auto made',
      ],
    ]);
  });
});

describe('where a message down a socket or out of a queue says what it is about', () => {
  it('is a runtime expression of AsyncAPI into the message', () => {
    expect(
      sentBy({
        ...overASocket,
        acknowledge: '$request.body#/envelope_id',
        wake: { when: { '$message.payload': ['events_api'], '$message.header#/kind': ['events_api'] } },
        connection: { account: '$request.body#/team_id', user: '$message.payload#/user' },
      }),
    ).toEqual([
      [`${destination}/wake/when/$message.payload`, ofTheMessage],
      [`${destination}/connection/account`, ofTheMessage],
      [`${destination}/acknowledge`, ofTheMessage],
    ]);
  });
});

const reply = `${destination}/wake/reply`;

const unproven =
  'Expected reply only where verify proves every byte of the body and a time, as standard-webhooks does, and hmac where it signs {payload} and a timestamp: a secret or a signed token in a header proves who sent a delivery, not that its body is theirs, so such a destination only makes Auto read';

const unowned =
  'Expected reply only beside connection, where a delivery names the account it happened in, so that a reply is taken only for the connections made in it';

const fromTheBody =
  'Expected $request.body#/<pointer>, a runtime expression of OpenAPI into the request, since a reply is read from the body alone, which the proof covers';

const fromThePayload =
  'Expected $message.payload#/<pointer>, a runtime expression of AsyncAPI into the message, since a reply is read from the body alone, which the proof covers';

function provenBy(verify: unknown) {
  const proven = { ...ofTheApp, verify };
  return sentBy(carrying(proven, aReply));
}

describe('the reply a delivery carries', () => {
  it('is declared where the proof covers every byte of the body and a time, and the arrival names its account', () => {
    expect([
      sentBy(carrying(ofTheApp, aReply)),
      sentBy(carrying(ofTheApp, without(aReply, 'time', 'changed'))),
      provenBy({ scheme: 'standard-webhooks', secret: 'app' }),
      provenBy({ ...ofTheApp.verify, signed_payload: '{payload}', timestamp: '$request.body#/sent_at' }),
    ]).toEqual([[], [], [], []]);
  });

  it('names where the reply is, who wrote it, its words and the message it answers', () => {
    expect(sentBy(carrying(ofTheApp, { time: aReply.time }))).toEqual([
      [`${reply}/id`, 'Missing key'],
      [`${reply}/sender`, 'Missing key'],
      [`${reply}/text`, 'Missing key'],
      [`${reply}/to`, 'Missing key'],
    ]);
    expect(sentBy(carrying(ofTheApp, { ...aReply, thread: '$request.body#/message/thread' }))).toMatchObject([
      [`${reply}/thread`, expect.any(String)],
    ]);
  });

  it('is read from the body alone, which the proof covers', () => {
    expect(
      sentBy(
        carrying(ofTheApp, {
          ...aReply,
          id: '$request.header.X-Message-Id',
          sender: '$request.query.author',
          changed: 'message.edited',
        }),
      ),
    ).toEqual([
      [`${reply}/id`, fromTheBody],
      [`${reply}/sender`, fromTheBody],
      [`${reply}/changed`, fromTheBody],
    ]);
  });
});

describe('a destination whose deliveries carry a reply', () => {
  it('proves every byte of the body and a time, which a secret or a token in a header does not', () => {
    expect([
      provenBy({ scheme: 'bearer', secret: 'app', token: '$request.header.X-Chat-Token' }),
      provenBy({ scheme: 'jwt', secret: 'app', token: '$request.header.Authorization', alg: 'HS256' }),
      provenBy({ ...ofTheApp.verify, signed_payload: '{payload}' }),
      provenBy({ ...without(ofTheApp.verify, 'timestamp'), signed_payload: '{payload}' }),
    ]).toEqual([[[reply, unproven]], [[reply, unproven]], [[reply, unproven]], [[reply, unproven]]]);
  });

  it('is no socket, which no proof of its own covers, though it reads a reply from the payload', () => {
    expect(sentBy(carrying(overASocket, { ...aReply, id: '$message.payload#/payload/event/ts' }))).toEqual([
      [`${reply}/sender`, fromThePayload],
      [`${reply}/text`, fromThePayload],
      [`${reply}/to`, fromThePayload],
      [`${reply}/time`, fromThePayload],
      [`${reply}/changed`, fromThePayload],
      [reply, unproven],
    ]);
  });

  it('names the account a delivery happened in, which an arrival of a subscription does not', () => {
    const subscribed = { ...ofEachSubscription, verify: { scheme: 'standard-webhooks', secret: 'subscription' } };

    expect(sentBy(carrying(subscribed, aReply))).toEqual([[reply, unowned]]);
  });
});

describe('the handshake of a destination', () => {
  it('answers its challenge as text, or in the fields of a JSON answer, the hmac beside an hmac proof alone', () => {
    const keyed = {
      ...ofTheApp.handshake,
      when: { '$request.body#/event': ['endpoint.url_validation'] },
      challenge: '$request.body#/payload/plainToken',
      response: { plainToken: 'challenge', encryptedToken: 'hmac' },
    };
    const bearing = { scheme: 'bearer', secret: 'app', token: '$request.header.X-Chat-Token' };

    expect(sentBy({ ...ofTheApp, handshake: keyed })).toEqual([]);
    expect(sentBy({ ...ofTheApp, handshake: keyed, verify: bearing })).toEqual([
      [
        `${destination}/handshake/response/encryptedToken`,
        "Expected hmac only where the destination's proof is hmac, whose hash, encoding and secret key it",
      ],
    ]);
  });

  it('finds its challenge in the request and is named by a condition', () => {
    expect(sentBy({ ...ofTheApp, handshake: { when: {}, challenge: 'challenge', signed: false } })).toMatchObject([
      [`${destination}/handshake/when`, noConditions],
      [`${destination}/handshake/challenge`, expect.stringContaining('a runtime expression of OpenAPI')],
    ]);
  });
});

describe('the socket a destination opens', () => {
  it('is found by a tool of the connection and where its answer names the address', () => {
    expect([opened({ tool: 'open connection', address: 'url' }), opened({ tool: 'open_connection' })]).toEqual([
      [
        [`${destination}/open/tool`, 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots'],
        [
          `${destination}/open/address`,
          'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1',
        ],
      ],
      [[`${destination}/open`, "Expected tool and address, the JSON Pointer to the socket's address it answers"]],
    ]);
  });

  it('is otherwise written out whole', () => {
    expect([
      opened({ url: 'wss://events.chat.example.com/{{ app }}' }),
      opened({ url: 'https://events.chat.example.com/socket' }),
      opened({ url: 'wss://events.chat.example.com/socket', tool: 'open_connection' }),
    ]).toEqual([
      [[`${destination}/open/url`, notWholeAddress]],
      [[`${destination}/open/url`, notWholeAddress]],
      [[`${destination}/open`, 'Expected tool and address, or url, and not both']],
    ]);
  });

  it('is opened with a value of the app named as its vendor names it', () => {
    expect(sentBy({ ...overASocket, credential: 'App Token' })).toMatchObject([
      [`${destination}/credential`, expect.stringContaining('the name of a value of the app')],
    ]);
  });
});
