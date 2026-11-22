import { describe, expect, it } from 'vitest';

import {
  aReply,
  aReplyOverASocket,
  carrying,
  firstDestination as destination,
  ofEachSubscription,
  ofTheApp,
  overASocket,
  overASocketCarryingReplies,
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

describe('where a request delivered to a webhook says what it is about', () => {
  it('is a runtime expression of OpenAPI into the request', () => {
    const filter = {
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

    expect(sentBy({ ...ofTheApp, filter, connection })).toEqual([
      [`${destination}/filter/when/$request.header.X Event`, ofTheRequest],
      [`${destination}/filter/when/$request.header.X(Event)`, ofTheRequest],
      [`${destination}/filter/when/$request.body`, ofTheRequest],
      [`${destination}/filter/when/$message.payload#/type`, ofTheRequest],
      [`${destination}/filter/conversation`, ofTheRequest],
      [`${destination}/filter/automatic`, ofTheRequest],
      [`${destination}/connection/account`, ofTheRequest],
    ]);
  });

  it('holds one condition at least, each with one value at least', () => {
    expect(sentBy({ ...ofTheApp, filter: { when: {} } })).toEqual([[`${destination}/filter/when`, noConditions]]);
    expect(sentBy({ ...ofTheApp, filter: { when: { '$request.body#/type': [] } } })).toMatchObject([
      [`${destination}/filter/when/$request.body#/type`, expect.any(String)],
    ]);
  });

  it('names the subscription only in an arrival of a destination per subscription', () => {
    expect(sentBy({ ...ofTheApp, filter: { ...ofTheApp.filter, subscription: '$request.header.X-Hook' } })).toEqual([
      [
        `${destination}/filter/subscription`,
        'Expected subscription only in the filter of a destination per subscription, whose arrivals name the subscription Auto made',
      ],
    ]);
  });
});

describe('the filter of a destination', () => {
  it('is named filter alone, so a destination that names it wake is refused at both places', () => {
    expect(sentBy({ ...without(ofTheApp, 'filter'), wake: ofTheApp.filter })).toEqual([
      [`${destination}/wake`, expect.any(String)],
      [`${destination}/filter`, expect.any(String)],
    ]);
  });
});

describe('where a message down a socket or out of a queue says what it is about', () => {
  it('is a runtime expression of AsyncAPI into the message', () => {
    expect(
      sentBy({
        ...overASocket,
        acknowledge: '$request.body#/envelope_id',
        filter: { when: { '$message.payload': ['events_api'], '$message.header#/kind': ['events_api'] } },
        connection: { account: '$request.body#/team_id', user: '$message.payload#/user' },
      }),
    ).toEqual([
      [`${destination}/filter/when/$message.payload`, ofTheMessage],
      [`${destination}/connection/account`, ofTheMessage],
      [`${destination}/acknowledge`, ofTheMessage],
    ]);
  });
});

const reply = `${destination}/filter/reply`;

const unproven =
  'Expected reply only on a websocket, or on a webhook whose verify proves every byte of the body and a time, as standard-webhooks does, and as hmac does where it signs {payload} and a timestamp. A secret or a signed token in a header proves who sent a delivery but not that its body is theirs, and nothing proves what a queue holds, so such a destination can only tell Auto to read the replies now';

const unowned =
  'Expected reply only beside connection, where a delivery names the account it happened in, so that a reply is taken only for the connections made in it';

const unplaced =
  "Expected reply only beside conversation, where a delivery names the conversation the reply was posted in, since a message's id may be unique only within its conversation, so that a reply is taken only for the request sent there as the message it answers";

const fromTheBody =
  'Expected $request.body#/<pointer>, a runtime expression of OpenAPI into the request, since a reply is read from the body alone, which the proof covers';

const fromThePayload =
  "Expected $message.payload#/<pointer>, a runtime expression of AsyncAPI into the message, since a reply is read from the message's payload alone";

function provenBy(verify: unknown) {
  const proven = { ...ofTheApp, verify };
  return carrying(proven, aReply);
}

function atTheReply(declared: unknown): readonly (readonly [string, string])[] {
  return sentBy(declared).filter(([path]) => path.startsWith(reply));
}

describe('the reply a delivery carries', () => {
  it('is declared where the proof covers every byte of the body and a time, and the arrival names its account', () => {
    expect([
      sentBy(carrying(ofTheApp, aReply)),
      sentBy(carrying(ofTheApp, without(aReply, 'time', 'changed'))),
      sentBy(provenBy({ scheme: 'standard-webhooks', secret: 'app' })),
      sentBy(provenBy({ ...ofTheApp.verify, signed_payload: '{payload}', timestamp: '$request.body#/sent_at' })),
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

  it('is read from the message’s payload alone where it arrives over a socket', () => {
    const elsewhere = { ...aReplyOverASocket, sender: '$message.header#/user', text: '$request.body#/event/text' };

    expect(atTheReply(carrying(overASocket, elsewhere))).toEqual([
      [`${reply}/sender`, fromThePayload],
      [`${reply}/text`, fromThePayload],
    ]);
  });
});

const subscribed = {
  ...ofEachSubscription,
  verify: { scheme: 'standard-webhooks', secret: 'subscription' },
  filter: { ...ofEachSubscription.filter, conversation: '$request.body#/channel' },
};

const signingTheBodyAlone = { ...ofTheApp.verify, signed_payload: '{payload}' };

const signingNoTime = { ...without(ofTheApp.verify, 'timestamp'), signed_payload: '{payload}' };

const inAHeader = { scheme: 'bearer', secret: 'app', token: '$request.header.X-Chat-Token' };

const signedApart = { scheme: 'jwt', secret: 'app', token: '$request.header.Authorization', alg: 'HS256' };

const anywhereOverASocket = { ...overASocket, filter: without(overASocket.filter, 'conversation') };

const anywhere = { ...ofTheApp, filter: without(ofTheApp.filter, 'conversation') };

describe('a destination whose deliveries carry a reply, which is proven and names the account and the conversation', () => {
  it.each([
    ['a socket the runtime opened itself', overASocketCarryingReplies, []],
    ['a webhook whose hmac signs the body alone', provenBy(signingTheBodyAlone), [[reply, unproven]]],
    ['a webhook whose hmac signs no time', provenBy(signingNoTime), [[reply, unproven]]],
    ['a webhook whose secret is a header', provenBy(inAHeader), [[reply, unproven]]],
    ['a webhook whose token is signed apart from the body', provenBy(signedApart), [[reply, unproven]]],
    ['a socket that names no account', without(overASocketCarryingReplies, 'connection'), [[reply, unowned]]],
    ['a webhook per subscription, which names no account', carrying(subscribed, aReply), [[reply, unowned]]],
    ['a socket that names no conversation', carrying(anywhereOverASocket, aReplyOverASocket), [[reply, unplaced]]],
    ['a webhook that names no conversation', carrying(anywhere, aReply), [[reply, unplaced]]],
  ] as const)('is %s', (_, declared, issues) => {
    expect(atTheReply(declared)).toEqual(issues);
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

const { open } = overASocket;

describe('the socket a destination opens', () => {
  it('is found by a request of the app and where its answer names the address', () => {
    expect([
      opened({ ...open, method: 'GET', url: `${open.url}?app=auto` }),
      opened({ ...open, method: 'PUT' }),
      opened({ ...open, address: 'url' }),
    ]).toEqual([
      [],
      [[`${destination}/open/method`, expect.any(String)]],
      [
        [
          `${destination}/open/address`,
          'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1',
        ],
      ],
    ]);
  });

  it('is opened with a value of the app named as its vendor names it', () => {
    expect(sentBy({ ...overASocket, credential: 'App Token' })).toMatchObject([
      [`${destination}/credential`, expect.stringContaining('the name of a value of the app')],
    ]);
  });
});

describe("the request that answers a socket's address", () => {
  it('takes the method, the url and the address of the request, and no tool or wss address of its own', () => {
    expect([
      opened({ url: open.url, address: open.address }),
      opened({ method: open.method, address: open.address }),
      opened({ method: open.method, url: open.url }),
      opened({ ...open, tool: 'open_connection' }),
      opened({ tool: 'open_connection', address: '/url' }),
      opened({ url: 'wss://events.chat.example.com/socket' }),
    ]).toEqual([
      [[`${destination}/open/method`, expect.any(String)]],
      [[`${destination}/open/url`, expect.any(String)]],
      [[`${destination}/open/address`, expect.any(String)]],
      [[`${destination}/open/tool`, expect.any(String)]],
      [
        [`${destination}/open/tool`, expect.any(String)],
        [`${destination}/open/method`, expect.any(String)],
        [`${destination}/open/url`, expect.any(String)],
      ],
      [
        [`${destination}/open/method`, expect.any(String)],
        [`${destination}/open/address`, expect.any(String)],
      ],
    ]);
  });

  it("is sent to an https URL written out whole, since it carries the app's credential there", () => {
    expect([
      opened({ ...open, url: 'wss://events.chat.example.com/socket' }),
      opened({ ...open, url: 'http://api.chat.example.com/connections.open' }),
      opened({ ...open, url: 'https://api.chat.example.com/{{ app }}/connections.open' }),
      opened({ ...open, url: 'https://{{ app }}.chat.example.com/connections.open' }),
    ]).toEqual([
      [[`${destination}/open/url`, expect.any(String)]],
      [[`${destination}/open/url`, expect.any(String)]],
      [[`${destination}/open/url`, expect.any(String)]],
      [[`${destination}/open/url`, expect.any(String)]],
    ]);
  });
});
