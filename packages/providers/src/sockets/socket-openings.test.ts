import { capturedLogs, recordingTracer } from '@on.auto/operations/testing';
import { bearerRequestOnce, type BearerSending, type RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Function, Option, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventDestinationOf } from '../reading/provider-list.ts';
import { ofTheApp, overASocket, trackerOverASocket } from '../testing/event-destinations.ts';
import { providersOf } from '../testing/fixture-providers.ts';
import { opensAsDeclared, type OpeningWays } from './socket-openings.ts';
import type { OpenSocket, SendsABearerRequest, SocketEnded, SocketOpening } from './socket-ports.ts';

type Destination = SocketOpening['destination'];

type Sending = OpeningWays['sending'];

type Refusal = ReturnType<Sending['reaches']>;

type Ended = Pick<SocketEnded, 'end' | 'code'>;

function destinationOf(declared: object, type: 'webhook' | 'websocket'): Destination {
  const entry = { ...trackerOverASocket, events: { destinations: [declared] } };
  return Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(providersOf(entry), 'tracker', type)));
}

const theOpening = 'https://api.chat.example.com/connections.open';

const theAppsValue = 'app-value-4b8e1d07';

const theTicket = 'ticket-9f2c6a31';

const theAddress = `wss://socket.chat.example.com/link/?ticket=${theTicket}&app_id=A1`;

const theAddressAs = (scheme: string) => theAddress.replace('wss:', scheme);

const overTheSocket = destinationOf(overASocket, 'websocket');

function openedAt(url: string, method: 'GET' | 'POST' = 'POST'): Destination {
  return { ...overTheSocket, open: { method, url, address: '/url' } };
}

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: string;
}

interface Opened {
  readonly ended: Ended | undefined;
  readonly sent: readonly Sent[];
  readonly reached: readonly string[];
  readonly constructed: readonly Redacted.Redacted[];
  readonly closed: number;
}

interface Setting {
  readonly answer?: () => Response;
  readonly destination?: Destination;
  readonly unreached?: (url: string) => Refusal;
  readonly sends?: SendsABearerRequest;
  readonly besideTheSending?: Readonly<Record<string, unknown>>;
}

type Traced = (opening: Effect.Effect<Ended | undefined>) => Effect.Effect<Ended | undefined>;

interface Service {
  readonly fetch: Sending['fetch'];
  readonly sent: () => readonly Sent[];
}

const aSocket: OpenSocket = { next: Effect.never, send: () => Effect.void, ping: Effect.void };

const answering = (body: unknown) => () => Response.json(body);

function serviceAnswering(answer: () => Response): Service {
  const sent: Sent[] = [];
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const request = new Request(String(address), Object.assign({}, init));
      const { url, method, redirect } = request;
      sent.push({ url, method, headers: Object.fromEntries(request.headers), body: await request.text(), redirect });
      return answer();
    },
    sent: () => [...sent],
  };
}

async function opened(setting: Setting, traced: Traced = Function.identity): Promise<Opened> {
  const reached: string[] = [];
  const constructed: Redacted.Redacted[] = [];
  let closed = 0;
  const { answer = answering({ ok: true, url: theAddress }), unreached = Function.constUndefined } = setting;
  const service = serviceAnswering(answer);
  const reaches = (url: string): Refusal => {
    reached.push(url);
    return unreached(url);
  };
  const sending = { fetch: service.fetch, reaches, callMs: 30_000, mostRequestBytes: 65_536 };
  const opens = opensAsDeclared({
    sends: setting.sends ?? bearerRequestOnce,
    sending: Object.assign(sending, setting.besideTheSending),
    constructs: (address) =>
      Effect.sync(() => constructed.push(address)).pipe(
        Effect.andThen(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed += 1;
            }),
          ),
        ),
        Effect.as(aSocket),
      ),
  });
  const opening = { destination: setting.destination ?? overTheSocket, credential: Redacted.make(theAppsValue) };
  const ended = await Effect.runPromise(
    traced(
      Effect.scoped(opens(opening)).pipe(
        Effect.match({ onFailure: (end: Ended) => end, onSuccess: Function.constUndefined }),
      ),
    ),
  );
  return { ended, sent: service.sent(), reached, constructed, closed };
}

const notOpened = 'not opened';

const endOf = (ended: Ended | undefined) => ended?.end ?? 'opened';

const unopened: RequestedOnce = { kind: 'unopened', because: 'connection_not_allowed' };

function carried({ origins, bearer }: BearerSending): readonly unknown[] {
  return [origins, bearer?.kind === 'key' ? Redacted.value(bearer.token) : bearer?.kind];
}

describe('a socket opened as its entry declares', () => {
  it("is opened at the address open's request answers, the app's value sent there alone, as a bearer token", async () => {
    const { ended, sent, reached, constructed, closed } = await opened({});

    expect(endOf(ended)).toBe('opened');
    expect(sent).toEqual([
      {
        url: theOpening,
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${theAppsValue}` },
        body: '',
        redirect: 'manual',
      },
    ]);
    expect([reached, constructed.map((address) => Redacted.value(address)), closed]).toEqual([
      [theOpening, theAddress],
      [theAddress],
      1,
    ]);
  });

  it('sends the method open declares', async () => {
    const { sent } = await opened({ destination: openedAt(theOpening, 'GET') });

    expect(sent.map(({ method }) => method)).toEqual(['GET']);
  });

  it('takes from no caller where the value goes, the value, or a connection to break', async () => {
    const given: BearerSending[] = [];
    const sends: SendsABearerRequest = (_request, sending) =>
      Effect.sync(() => given.push(sending)).pipe(Effect.as(unopened));
    const besideTheSending = {
      origins: ['https://elsewhere.example.com'],
      bearer: { kind: 'key', token: Redacted.make('another-value') },
      refused: () => Promise.resolve(),
    };
    const { ended } = await opened({ sends, besideTheSending });

    expect(endOf(ended)).toBe(notOpened);
    expect(given.map((sending) => carried(sending))).toEqual([[['https://api.chat.example.com'], theAppsValue]]);
    expect(given.map((sending) => Object.keys(sending).toSorted())).toEqual([
      ['bearer', 'callMs', 'fetch', 'mostRequestBytes', 'origins', 'reaches'],
    ]);
  });
});

describe('an answer that names no socket address', () => {
  it.each([
    ['no address at its pointer', answering({ ok: false, error: 'not_allowed_token_type' })],
    ['an address that is no text', answering({ url: 42 })],
    ['an address that is no URL', answering({ url: 'socket.chat.example.com/link' })],
    ['an https address', answering({ url: theAddressAs('https:') })],
    ['a ws address, which has no TLS', answering({ url: theAddressAs('ws:') })],
    ['a wss address that names a user', answering({ url: theAddress.replace('wss://', 'wss://app:pass@') })],
    ['nothing', () => new Response(null, { status: 204 })],
  ])('opens nothing for %s', async (_answered, answer) => {
    const { ended, sent, constructed } = await opened({ answer });

    expect([endOf(ended), sent.length, constructed]).toEqual([notOpened, 1, []]);
  });
});

describe("a refusal of the app's value, or a redirect", () => {
  it.each([401, 403, 500])('opens nothing where the service answers %i, the value sent once', async (status) => {
    const { ended, sent, constructed } = await opened({ answer: () => new Response(null, { status }) });

    expect([endOf(ended), sent.length, constructed]).toEqual([notOpened, 1, []]);
  });

  it.each([301, 302, 307, 308])('follows no redirect of %i, and opens nothing', async (status) => {
    const location = `https://elsewhere.example.com/open?url=${encodeURIComponent(theAddress)}`;
    const { ended, sent, constructed } = await opened({
      answer: () => new Response(null, { status, headers: { location } }),
    });

    expect([endOf(ended), sent.map(({ url, redirect }) => [url, redirect]), constructed]).toEqual([
      notOpened,
      [[theOpening, 'manual']],
      [],
    ]);
  });
});

const notAllowed = (): Refusal => 'not allowed';

function lookupFailed(): never {
  throw new Error('lookup failed');
}

function unreachedAt(host: string, refusal: () => Refusal = notAllowed): (url: string) => Refusal {
  return (url) => (new URL(url).hostname === host ? refusal() : undefined);
}

describe('what the runtime reaches', () => {
  it("sends nothing to open's host where the runtime does not reach it", async () => {
    const { ended, sent, constructed } = await opened({ unreached: unreachedAt('api.chat.example.com') });

    expect([endOf(ended), sent, constructed]).toEqual([notOpened, [], []]);
  });

  it.each([
    ['is not allowed', notAllowed],
    ['cannot be looked up', (): Refusal => Promise.reject(new Error('lookup failed'))],
    ['throws as it is looked up', lookupFailed],
  ])('opens no socket at an answered host that %s', async (_reason, refusal) => {
    const { ended, sent, constructed } = await opened({ unreached: unreachedAt('socket.chat.example.com', refusal) });

    expect([endOf(ended), sent.length, constructed]).toEqual([notOpened, 1, []]);
  });
});

describe('a destination whose opening is no declared https request', () => {
  it.each([
    ['no open', destinationOf(ofTheApp, 'webhook')],
    ['an http URL', openedAt('http://api.chat.example.com/connections.open')],
    ['no URL', openedAt('api.chat.example.com/connections.open')],
    ['a URL that names a user', openedAt('https://app:pass@api.chat.example.com/connections.open')],
  ])('sends nothing and opens nothing for %s', async (_declared, destination) => {
    const { ended, sent, constructed } = await opened({ destination });

    expect([endOf(ended), sent, constructed]).toEqual([notOpened, [], []]);
  });
});

const leftOut = [theAppsValue, theTicket, 'socket.chat.example.com', '/link/'];

const answersHoldingTheAddress = [
  answering({ ok: true, url: theAddress }),
  answering({ ok: true, link: theAddress }),
  answering({ ok: true, url: theAddressAs('https:') }),
  () => new Response(theAddress, { status: 401 }),
  () => new Response(null, { status: 302, headers: { location: theAddress } }),
];

describe('what an opening leaves behind', () => {
  it("holds the app's value and the socket's address in no log, span or failure", async () => {
    const recording = recordingTracer();
    const logs = capturedLogs();
    const traced: Traced = (opening) => opening.pipe(Effect.withTracer(recording.tracer), Effect.provide(logs.layer));
    const openings = await Promise.all(answersHoldingTheAddress.map((answer) => opened({ answer }, traced)));
    const unreached = unreachedAt('socket.chat.example.com');
    const failures = [...openings, await opened({ unreached }, traced)].map(({ ended }) => ended);
    const constructed = openings.flatMap((opening) => opening.constructed);
    const left = JSON.stringify([failures, recording.spans(), logs.logged(), constructed]);

    expect([logs.logged(), constructed.length, recording.spans().length]).toEqual([[], 1, 6]);
    expect(failures.map((ended) => endOf(ended))).toEqual(['opened', ...answersHoldingTheAddress.map(() => notOpened)]);
    expect(leftOut.filter((value) => left.includes(value))).toEqual([]);
  });
});
