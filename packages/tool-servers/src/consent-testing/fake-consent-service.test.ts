import { createHash } from 'node:crypto';

import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ServiceStartAsked } from '../consent-through-auto/consent-service.ts';
import {
  consentedAt,
  cuttingTimeouts,
  inProcessFetch,
  studioBase,
  throughAutoInProcess,
  type ClientRegistration,
  type FakeMcpServer,
} from '../testing/index.ts';
import {
  postedToTheService,
  redeemedThrough,
  serviceCallsAt,
  studioSession,
  type ServiceListing,
  type ThroughAuto,
} from './auto-consents.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function serving(changes: Partial<ClientRegistration> = {}, listing: ServiceListing = {}): ThroughAuto {
  const served = throughAutoInProcess(changes, listing);
  closing.push(served.close);
  return served;
}

const verifier = 'a-handoff-verifier-of-forty-three-characters';

function startOf(vendor: Pick<FakeMcpServer, 'origin'>, changes: Partial<ServiceStartAsked> = {}): ServiceStartAsked {
  return {
    issuer: vendor.origin,
    scope: 'files.read',
    parameters: { access_type: 'offline' },
    resources: [`${vendor.origin}/mcp`],
    returnTo: { kind: 'loopback', base: 'http://127.0.0.1:5555/studio/' },
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    ...changes,
  };
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.result(effect));
}

function redeemedAt(served: ThroughAuto) {
  return redeemedThrough(served, startOf(served.fake));
}

describe('the clients the fake consent service lists', () => {
  it('are its one client, at the issuer of the fake authorization server, with the scopes it names where it names them', async () => {
    const { fake: vendor, service } = serving();
    const naming = serving({}, { scopes: ['files.read'] });

    expect([
      await Effect.runPromise(serviceCallsAt(service).clients),
      await Effect.runPromise(serviceCallsAt(naming.service).clients),
    ]).toEqual([
      [{ issuer: vendor.origin, client_id: 'auto-runtime' }],
      [{ issuer: naming.fake.origin, client_id: 'auto-runtime', scopes: ['files.read'] }],
    ]);
  });
});

describe('the fake consent service whose client states application permissions', () => {
  it('lists the client with them, and makes only a start that asks them, as the service does with a client of each permissions', async () => {
    const stating = serving({}, { permissions: 'application' });
    const unstating = serving();
    const [calls, callsOfNone] = [serviceCallsAt(stating.service), serviceCallsAt(unstating.service)];

    expect([
      await Effect.runPromise(calls.clients),
      await run(calls.start(startOf(stating.fake, { permissions: 'application' }))),
      await run(calls.start(startOf(stating.fake))),
      await run(callsOfNone.start(startOf(unstating.fake, { permissions: 'application' }))),
    ]).toMatchObject([
      [{ issuer: stating.fake.origin, client_id: 'auto-runtime', permissions: 'application' }],
      { _tag: 'Success' },
      { failure: { refused: 'start_refused' } },
      { failure: { refused: 'start_refused' } },
    ]);
  });
});

describe('a start at the fake consent service', () => {
  it('answers the page of the authorization server with its client, its own state and challenge, and the parameters asked', async () => {
    const { fake: vendor, service } = serving();

    const started = await Effect.runPromise(serviceCallsAt(service).start(startOf(vendor)));
    const asked = Object.fromEntries(new URL(started.url).searchParams);

    expect(asked).toMatchObject({
      client_id: 'auto-runtime',
      redirect_uri: 'https://studio.example.com/connect-return',
      code_challenge_method: 'S256',
      state: started.state,
      scope: 'files.read',
      resource: `${vendor.origin}/mcp`,
      access_type: 'offline',
    });
    expect(new URL(started.url).searchParams.get('code_challenge')).not.toBe(startOf(vendor).challenge);
    expect(started.expires_at).toBe('1970-01-01T00:10:00.000Z');
  });

  it('is refused for an issuer it has no client at, a malformed request and when told to', async () => {
    const { fake: vendor, service } = serving();
    const calls = serviceCallsAt(service);
    service.refuseNext('start');

    expect([
      await run(calls.start(startOf(vendor))),
      await run(calls.start(startOf(vendor, { issuer: 'https://elsewhere.example.com' }))),
      await postedToTheService(service, '/consents', '{"issuer":1}'),
      await run(calls.start(startOf(vendor, { returnTo: { kind: 'hosted', base: studioBase }, scope: undefined }))),
    ]).toMatchObject([
      { failure: { refused: 'start_refused' } },
      { failure: { refused: 'start_refused' } },
      { status: 400 },
      { _tag: 'Success' },
    ]);
  });
});

describe('a start at the fake consent service with a return base it does not send people back to', () => {
  it('is refused for a Studio host other than its own, and a loopback base that is not one of http, a loopback host and a closing slash', async () => {
    const { fake: vendor, service } = serving();
    const calls = serviceCallsAt(service);
    const startsAt = (kind: 'hosted' | 'loopback', base: string) =>
      run(calls.start(startOf(vendor, { returnTo: { kind, base } })));

    expect([
      await startsAt('hosted', 'https://studio.example.org/'),
      await startsAt('loopback', 'https://127.0.0.1:5555/studio/'),
      await startsAt('loopback', 'http://studio.example.org/'),
      await startsAt('loopback', 'http://localhost:5555/studio'),
      await startsAt('loopback', 'not an address'),
      await startsAt('loopback', 'http://[::1]/'),
    ]).toMatchObject([
      ...Array.from({ length: 5 }, () => ({ failure: { refused: 'start_refused' } })),
      { _tag: 'Success' },
    ]);
  });
});

describe('a state the hosted Studio asks the fake consent service to describe', () => {
  it('is described to a person signed in, while it is open, and unknown once its ten minutes are over', async () => {
    const { fake: vendor, service, clock } = serving();
    const calls = serviceCallsAt(service);
    const started = await Effect.runPromise(calls.start(startOf(vendor)));

    const open = await run(calls.describe(started.state, studioSession));
    const unsigned = await run(calls.describe(started.state, Redacted.make('')));
    const unknown = await run(calls.describe('another-state', studioSession));
    clock.setTo(600_000);
    const ended = await run(calls.describe(started.state, studioSession));

    expect([open, unsigned, unknown, ended]).toMatchObject([
      { success: { issuer: vendor.origin, return: { kind: 'loopback', base: 'http://127.0.0.1:5555/studio/' } } },
      { failure: { refused: 'unanswered' } },
      { _tag: 'Success', success: undefined },
      { _tag: 'Success', success: undefined },
    ]);
  });

  it('is refused to a call without a session with 401, asking for a bearer', async () => {
    const { service } = serving();

    const answer = await inProcessFetch(`${service.url}/consents/a-state`);
    await answer.text();

    expect([answer.status, answer.headers.get('www-authenticate')]).toEqual([401, 'Bearer']);
  });
});

describe('a code the hosted Studio asks the fake consent service to redeem', () => {
  it('is redeemed once for a person signed in, and refused when redeemed again, unknown, refused by the authorization server or when told to', async () => {
    const serve = serving();
    const { fake: vendor, service } = serve;
    const calls = serviceCallsAt(service);
    const { started, code } = await redeemedAt(serve);
    const another = await Effect.runPromise(calls.start(startOf(vendor)));
    const third = await Effect.runPromise(calls.start(startOf(vendor)));
    const thirdCode = (await consentedAt(third.url)).code;
    service.refuseNext('redeem');

    expect([
      await run(calls.redeem(third.state, studioSession, { code: thirdCode })),
      await run(calls.redeem(started.state, studioSession, { code })),
      await run(calls.redeem('another-state', studioSession, { code })),
      await run(calls.redeem(another.state, studioSession, { code: 'a-code-nobody-issued' })),
      await run(calls.redeem(another.state, Redacted.make(''), { code: 'x' })),
      await postedToTheService(service, `/consents/${another.state}/redeem`, '{}', {
        authorization: 'Bearer a-session',
      }),
      await postedToTheService(service, `/consents/${another.state}/redeem`, '{"code":"x"}'),
    ]).toMatchObject([
      { failure: { refused: 'code' } },
      { failure: { refused: 'redeemed' } },
      { failure: { refused: 'no_consent' } },
      { failure: { refused: 'code' } },
      { failure: { refused: 'unanswered' } },
      { status: 404 },
      { status: 401 },
    ]);
  });
});

describe('a call the fake consent service does not know', () => {
  it('is answered as not found', async () => {
    const { service } = serving();

    expect([
      await postedToTheService(service, '/consents/a/b/c', '{}'),
      await postedToTheService(service, '/clients', '{}'),
    ]).toMatchObject([{ status: 404 }, { status: 404 }]);
  });
});

describe('the calls the fake consent service heard', () => {
  it('are recorded with what each sent, and stalled once it is told to stall, until the bound of the stalled call ends', async () => {
    const { fake: vendor, service } = serving();
    const { requestTimeout, cutWhen } = cuttingTimeouts();
    const calls = serviceCallsAt(service, requestTimeout);
    await Effect.runPromise(calls.clients);
    service.stall();

    const starting = run(calls.start(startOf(vendor)));
    await cutWhen(() => service.calls().length === 2);

    expect(await starting).toMatchObject({ failure: { refused: 'unanswered' } });
    expect(service.calls()).toMatchObject([
      { method: 'GET', path: '/clients', body: '', authorization: null },
      { method: 'POST', path: '/consents', body: { issuer: vendor.origin, challenge_method: 'S256' } },
    ]);
  });
});
