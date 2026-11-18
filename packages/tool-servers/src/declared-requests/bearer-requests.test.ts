import { HostUnresolved } from '@on.auto/outbound';
import { Effect, Function, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answeredEmpty,
  answeredJson,
  answeringService,
  heldTokens,
  type AnsweringService,
} from '../testing/sent-requests.ts';
import type { BearerSending } from './bearer-requests.ts';
import type { Bearer } from './carried-credentials.ts';
import type { DeclaredRequest, RequestedOnce } from './declared-requests.ts';
import { bearerRequestOnce } from './request-ways.ts';

const origin = 'https://api.tracker.example.com';

const hooks = `${origin}/projects/acme-web/hooks`;

const pastedKey = 'tracker-key-7f3c1a9e5b';

const subscribing: DeclaredRequest = {
  method: 'POST',
  url: hooks,
  body: { url: 'https://runtime.example.com/events', secret: 'subscription-secret-41d8c2' },
};

const key: Bearer = { kind: 'key', token: Redacted.make(pastedKey) };

const accessToken = 'tracker-access-token-1';

const renewedToken = 'tracker-access-token-2';

function tokenUnder(unnamedResourceBase: string | null, recordedResources: readonly string[] = []) {
  const held = heldTokens(accessToken, renewedToken);
  const audience = { recordedResources, unnamedResourceBase: unnamedResourceBase ?? undefined };
  const bearer: Bearer = { kind: 'token', tokens: held, audience };
  return { held, bearer };
}

function sendingOf(service: AnsweringService, changes: Partial<BearerSending> = {}): BearerSending {
  return {
    origins: [origin],
    bearer: key,
    fetch: service.fetch,
    reaches: Function.constUndefined,
    callMs: 5000,
    mostRequestBytes: 1_048_576,
    ...changes,
  };
}

function requested(request: DeclaredRequest, sending: BearerSending): Promise<RequestedOnce> {
  return Effect.runPromise(bearerRequestOnce(request, sending));
}

function created(): AnsweringService {
  return answeringService(answeredJson(201, { id: 'hook-1' }));
}

function refusalsKept() {
  const told: string[] = [];
  return {
    refused: (answered: string) => {
      told.push(answered);
      return Promise.resolve('The key of the connection tracker was refused');
    },
    told: () => [...told],
  };
}

const notAllowed = { kind: 'unopened', because: 'connection_not_allowed' };

describe('a request an entry declares', () => {
  it('is sent once to the origin it declares, its key in the Authorization header alone, following no redirect', async () => {
    const service = created();

    expect(await requested(subscribing, sendingOf(service))).toEqual({
      kind: 'answered',
      outcome: 'result',
      answer: { id: 'hook-1' },
    });
    expect(service.sent()).toEqual([
      {
        url: hooks,
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${pastedKey}`,
        },
        body: JSON.stringify(subscribing.body),
        redirect: 'manual',
      },
    ]);
  });

  it('sends a request with no body as one with no body', async () => {
    const service = answeringService(answeredEmpty(204));

    expect(await requested({ method: 'DELETE', url: `${hooks}/hook-1` }, sendingOf(service))).toEqual({
      kind: 'answered',
      outcome: 'result',
    });
    expect(service.sent()).toMatchObject([
      { method: 'DELETE', headers: { accept: 'application/json', authorization: `Bearer ${pastedKey}` }, body: '' },
    ]);
  });
});

describe('a request to where its entry does not send it', () => {
  it.each([
    ['an origin its entry does not declare', { ...subscribing, url: 'https://hooks.example.net/projects' }, {}],
    ['a connection whose entry declares no request, or that has no entry', subscribing, { origins: [] }],
    [
      'http',
      { ...subscribing, url: 'http://api.tracker.example.com/hooks' },
      { origins: [origin, 'http://api.tracker.example.com'] },
    ],
    ['an address that names a user', { ...subscribing, url: 'https://someone:pw@api.tracker.example.com/hooks' }, {}],
    ['an address that is not a URL', { ...subscribing, url: 'api.tracker.example.com/hooks' }, {}],
  ])('is not sent for %s', async (_case, request: DeclaredRequest, changes: Partial<BearerSending>) => {
    const service = created();

    expect(await requested(request, sendingOf(service, changes))).toEqual(notAllowed);
    expect(service.sent()).toEqual([]);
  });
});

describe('a request whose credential may not go where it is sent', () => {
  it('is not sent where the connection holds no bearer token', async () => {
    const service = created();

    expect(await requested(subscribing, sendingOf(service, { bearer: undefined }))).toEqual(notAllowed);
    expect(service.sent()).toEqual([]);
  });

  it('is not sent with a token no resource covers, recorded or none, and the token is not even asked for', async () => {
    const service = created();
    const unrecorded = tokenUnder(null);
    const recordedElsewhere = tokenUnder(null, [`${origin}/v2`]);
    const outsideItsBase = tokenUnder(`${origin}/v1`);
    const lacking = { kind: 'unopened', because: 'scope_lacking' };

    expect([
      await requested(subscribing, sendingOf(service, { bearer: unrecorded.bearer })),
      await requested(subscribing, sendingOf(service, { bearer: recordedElsewhere.bearer })),
      await requested(subscribing, sendingOf(service, { bearer: outsideItsBase.bearer })),
    ]).toEqual([lacking, lacking, lacking]);
    expect(service.sent()).toEqual([]);
    expect([unrecorded.held.asked(), recordedElsewhere.held.asked(), outsideItsBase.held.asked()]).toEqual([0, 0, 0]);
  });

  it('is sent with a token under the base URL of its HTTP API or a resource its sign-in recorded, in the Authorization header alone', async () => {
    const service = created();
    const underItsBase = tokenUnder(`${origin}/projects`);
    const recordedThere = tokenUnder(null, [`${origin}/projects/acme-web`]);

    expect([
      await requested(subscribing, sendingOf(service, { bearer: underItsBase.bearer })),
      await requested(subscribing, sendingOf(service, { bearer: recordedThere.bearer })),
    ]).toMatchObject([{ outcome: 'result' }, { outcome: 'result' }]);
    expect(service.sent().map(({ headers }) => headers['authorization'])).toEqual([
      `Bearer ${accessToken}`,
      `Bearer ${accessToken}`,
    ]);
  });
});

describe('a request the runtime may not send', () => {
  it('is not sent to a host outside what the runtime reaches, or that cannot be looked up', async () => {
    const service = created();
    const refusing = sendingOf(service, {
      reaches: () => 'A connection may not reach the host api.tracker.example.com',
    });
    const unresolved = sendingOf(service, {
      reaches: () => Promise.reject(new HostUnresolved({ host: 'api.tracker.example.com' })),
    });

    expect([await requested(subscribing, refusing), await requested(subscribing, unresolved)]).toEqual([
      notAllowed,
      { kind: 'unopened', because: 'unreachable' },
    ]);
    expect(service.sent()).toEqual([]);
  });

  it('is not sent when its body is larger than the connection takes', async () => {
    const service = created();

    expect(await requested(subscribing, sendingOf(service, { mostRequestBytes: 16 }))).toEqual({
      kind: 'unopened',
      because: 'too_large',
    });
    expect(service.sent()).toEqual([]);
  });

  it('follows no redirect: one request, none to where the redirect points, and the redirect a failure', async () => {
    const service = answeringService(answeredEmpty(302, { location: 'https://hooks.example.net/collect' }));

    expect(await requested(subscribing, sendingOf(service))).toEqual({ kind: 'answered', outcome: 'tool_error' });
    expect(service.sent().map(({ url, redirect }) => [url, redirect])).toEqual([[hooks, 'manual']]);
  });
});

const broken = { kind: 'answered', outcome: 'server_failure', because: 'connection_broken' };

describe('a refused key', () => {
  it('marks the connection broken once, sent once', async () => {
    const service = answeringService(answeredEmpty(401));
    const refusals = refusalsKept();

    expect(await requested(subscribing, sendingOf(service, { refused: refusals.refused }))).toEqual(broken);
    expect([service.sent().length, refusals.told()]).toEqual([1, ['The tool server answered HTTP 401']]);
  });

  it('is the reason itself where nothing tells the connection, as for an app of its own', async () => {
    const service = answeringService(answeredEmpty(401));

    expect(await requested(subscribing, sendingOf(service))).toEqual({
      kind: 'answered',
      outcome: 'server_failure',
      because: 'key_refused',
    });
  });
});

describe('a refused token', () => {
  it('is renewed once, and marks the connection broken once the new one is refused too', async () => {
    const service = answeringService(answeredEmpty(401));
    const refusals = refusalsKept();
    const { held, bearer } = tokenUnder(origin);

    expect(await requested(subscribing, sendingOf(service, { bearer, refused: refusals.refused }))).toEqual(broken);
    expect(service.sent().map(({ headers }) => headers['authorization'])).toEqual([
      `Bearer ${accessToken}`,
      `Bearer ${renewedToken}`,
    ]);
    expect([held.renewals(), refusals.told().length]).toEqual([1, 1]);
  });

  it('is answered with the new token, and breaks nothing, where the new one is taken', async () => {
    const service = answeringService(answeredEmpty(401), answeredJson(200, { id: 'hook-1' }));
    const refusals = refusalsKept();
    const { bearer } = tokenUnder(origin);

    expect(await requested(subscribing, sendingOf(service, { bearer, refused: refusals.refused }))).toMatchObject({
      outcome: 'result',
      answer: { id: 'hook-1' },
    });
    expect([service.sent().length, refusals.told()]).toEqual([2, []]);
  });
});
