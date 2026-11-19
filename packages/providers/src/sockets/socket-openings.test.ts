import { capturedLogs, recordingTracer } from '@on.auto/operations/testing';
import type { BearerSending } from '@on.auto/tool-servers';
import { Effect, Fiber, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { ofTheApp } from '../testing/event-destinations.ts';
import {
  answering,
  destinationOf,
  endOf,
  failureCodes,
  notOpened,
  opened,
  openedAt,
  theAddress,
  theAddressAs,
  theAppsValue,
  theOpening,
  theTicket,
  unopened,
  type Refusal,
  type Traced,
} from '../testing/opened-sockets.ts';
import { openedAndClosed, socketBackoff } from './socket-listening.ts';
import { SocketEnded, type OpensASocket, type SendsABearerRequest } from './socket-ports.ts';

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

describe('the request that opens a socket', () => {
  it("is handed the entry's failure codes, and never a way to break the connection", async () => {
    const given: BearerSending[] = [];
    const sends: SendsABearerRequest = (_request, sending) =>
      Effect.sync(() => given.push(sending)).pipe(Effect.as(unopened));
    await opened({ sends, failureCodes, besideTheSending: { refused: () => Promise.resolve() } });

    expect(given.map(({ failureCodes: codes, refused }) => [codes, refused])).toEqual([[failureCodes, undefined]]);
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
  it.each([403, 500])('opens nothing where the service answers %i, the value sent once', async (status) => {
    const { ended, sent, constructed } = await opened({ answer: () => new Response(null, { status }) });

    expect([endOf(ended), sent.length, constructed]).toEqual([notOpened, 1, []]);
  });

  it("ends refused where the service refuses the app's value by a 401 or by a code the entry lists as a refused key", async () => {
    const answers = [() => new Response(null, { status: 401 }), answering({ ok: false, error: 'invalid_auth' })];
    const openings = await Promise.all(answers.map((answer) => opened({ answer, failureCodes })));

    expect(openings.map(({ ended, sent, constructed }) => [endOf(ended), sent.length, constructed])).toEqual([
      ['refused', 1, []],
      ['refused', 1, []],
    ]);
  });

  it('is never refused by a code the entry does not list, or by an answer that is no JSON', async () => {
    const answers = [answering({ ok: false, error: 'not_allowed_token_type' }), () => new Response('invalid_auth')];
    const openings = await Promise.all(answers.map((answer) => opened({ answer, failureCodes })));

    expect(openings.map(({ ended }) => endOf(ended))).toEqual([notOpened, notOpened]);
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

function carried({ origins, bearer }: BearerSending): readonly unknown[] {
  return [origins, bearer?.kind === 'key' ? Redacted.value(bearer.token) : bearer?.kind];
}

const notOpenedThere = () => Effect.fail(new SocketEnded({ end: 'not opened' }));

describe('the host a socket could not be opened at', () => {
  it("is open's host where its answer names no socket, and the socket's host where that is not reached or not opened", async () => {
    const openings = await Promise.all([
      opened({ answer: answering({ ok: true }) }),
      opened({ unreached: unreachedAt('socket.chat.example.com') }),
      opened({ constructed: notOpenedThere }),
      opened({ constructed: () => Effect.fail(new SocketEnded({ end: 'closed', code: 1006 })) }),
    ]);

    expect(openings.map(({ ended }) => [ended?.end, ended?.host])).toEqual([
      [notOpened, 'api.chat.example.com'],
      [notOpened, 'socket.chat.example.com'],
      [notOpened, 'socket.chat.example.com'],
      ['closed', undefined],
    ]);
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

const leftOut = [theAppsValue, theTicket, '/link/'];

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
    expect(failures.map((ended) => endOf(ended))).toEqual([
      'opened',
      notOpened,
      notOpened,
      'refused',
      notOpened,
      notOpened,
    ]);
    expect(leftOut.filter((value) => left.includes(value))).toEqual([]);
  });
});

describe('a socket opened once, as a value given is checked', () => {
  it('is closed at once, and given up as not opened past the bound of an opening', async () => {
    const closings: string[] = [];
    const opens: OpensASocket = () =>
      Effect.as(
        Effect.addFinalizer(() => Effect.sync(() => closings.push('closed'))),
        { next: Effect.never, send: () => Effect.void, ping: Effect.void },
      );
    const opening = { destination: openedAt(theOpening), credential: Redacted.make(theAppsValue) };
    const hanging = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(openedAndClosed(() => Effect.never, opening)));
      yield* TestClock.adjust(socketBackoff.openingMs);
      return yield* Fiber.join(fiber);
    });

    await Effect.runPromise(openedAndClosed(opens, opening));
    const ended = await Effect.runPromise(hanging.pipe(Effect.provide(TestClock.layer())));

    expect([closings, ended.end]).toEqual([['closed'], 'not opened']);
  });
});
