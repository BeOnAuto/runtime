import { authenticatorFor, createApiKey, type Principal } from '@on.auto/identity';
import { allPermissions, type CallerIdentity } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import type { CookieSessions, RegisterRoutes } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';

const acme = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const keyHolders = authenticatorFor({ host: '0.0.0.0', apiKeys: [acme.entry] });

const ada: CallerIdentity = { id: 'person:ada', name: 'ada', org: 'acme', permissions: allPermissions, playbooks: '*' };

const adaSignedIn: Principal = { own: ada, callerIn: (org) => (org === ada.org ? ada : undefined) };

const adaSession = 'the-session-of-ada';

const whoIsCalling: RegisterRoutes = (routes) => {
  routes.add('GET', '/v1/orgs/:org/whoami', (c) => c.json(c.get('principal').callerIn(c.req.param('org') ?? '')));
};

const whoami = '/v1/orgs/acme/whoami';

const notes = '/v1/orgs/acme/notes';

type RequestHeaders = Readonly<Record<string, string>>;

const withTheSession: RequestHeaders = { cookie: `__Host-session=${adaSession}` };

const requestedByThePage: RequestHeaders = { 'x-csrf': '1' };

interface Kept {
  readonly sessions: CookieSessions;
  readonly asked: string[];
}

function adaSessionKept(): Kept {
  const asked: string[] = [];
  return {
    sessions: {
      principalOf: (identifier) => {
        asked.push(identifier);
        return Promise.resolve(identifier === adaSession ? adaSignedIn : undefined);
      },
    },
    asked,
  };
}

interface Changes {
  readonly route: RegisterRoutes;
  readonly made: string[];
}

function changesMade(): Changes {
  const made: string[] = [];
  return {
    route: (routes) => {
      routes.add('POST', '/v1/orgs/:org/notes', (c) => {
        made.push(c.get('principal').own.id);
        return c.json({}, 201);
      });
    },
    made,
  };
}

describe('a session held in a cookie, on a runtime that keeps sessions', () => {
  it('serves a request that carries the session cookie and the anti-forgery header as the person of the session', async () => {
    const { sessions, asked } = adaSessionKept();
    const changes = changesMade();
    const routes = [whoIsCalling, changes.route];
    const { handler } = createTestHandler({ authenticator: keyHolders, sessions, routes });
    const headers = { ...withTheSession, ...requestedByThePage };

    const read = await call(handler, whoami, { headers });
    const changed = await call(handler, notes, { method: 'POST', headers });

    expect(read).toMatchObject({ status: 200, body: ada });
    expect([changed.status, changes.made, asked]).toEqual([201, ['person:ada'], [adaSession, adaSession]]);
  });

  const withoutTheHeader: ReadonlyArray<readonly [string, RequestHeaders]> = [
    ['without the anti-forgery header', {}],
    ['with another value of the anti-forgery header', { 'x-csrf': 'true' }],
  ];

  it.each(withoutTheHeader)(
    'takes the cookie %s as no credential, so a request that changes something changes nothing',
    async (_case, header) => {
      const { sessions, asked } = adaSessionKept();
      const changes = changesMade();
      const { handler } = createTestHandler({ authenticator: keyHolders, sessions, routes: [changes.route] });

      const answer = await call(handler, notes, { method: 'POST', headers: { ...withTheSession, ...header } });

      expect([answer.status, answer.headers.get('www-authenticate')]).toEqual([401, 'Bearer']);
      expect([changes.made, asked]).toEqual([[], []]);
    },
  );
});

describe('a session held in a cookie, as the runtime refuses it', () => {
  it('reads the session only from the cookie of the __Host- prefix, which no other host can set', async () => {
    const { sessions, asked } = adaSessionKept();
    const { handler } = createTestHandler({ authenticator: keyHolders, sessions, routes: [whoIsCalling] });

    const answer = await call(handler, whoami, { headers: { cookie: `session=${adaSession}`, ...requestedByThePage } });

    expect([answer.status, asked]).toEqual([401, []]);
  });

  it('answers a session it does not keep, or keeps no longer, as no credential', async () => {
    const { sessions, asked } = adaSessionKept();
    const { handler } = createTestHandler({ authenticator: keyHolders, sessions, routes: [whoIsCalling] });

    const answer = await call(handler, whoami, { headers: { cookie: '__Host-session=ended', ...requestedByThePage } });

    expect([answer.status, answer.headers.get('www-authenticate'), asked]).toEqual([401, 'Bearer', ['ended']]);
  });

  it('takes an Authorization header over the cookie, and still refuses a malformed one', async () => {
    const { sessions, asked } = adaSessionKept();
    const { handler } = createTestHandler({ authenticator: keyHolders, sessions, routes: [whoIsCalling] });
    const beside = { ...withTheSession, ...requestedByThePage };

    const keyHolder = await call(handler, whoami, { headers: { ...beside, authorization: `Bearer ${acme.key}` } });
    const malformed = await call(handler, whoami, { headers: { ...beside, authorization: 'Bearer' } });

    expect(keyHolder).toMatchObject({ status: 200, body: { id: 'acme-reader' } });
    expect([malformed.status, asked]).toEqual([400, []]);
  });
});

describe('a session cookie on a runtime that keeps no sessions', () => {
  it('is no credential, whatever header comes with it', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    const answer = await call(handler, whoami, { headers: { ...withTheSession, ...requestedByThePage } });

    expect([answer.status, answer.headers.get('www-authenticate')]).toEqual([401, 'Bearer']);
  });
});
