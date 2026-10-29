import { createHash } from 'node:crypto';

import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ServiceStartAsked } from '../consent-through-auto/consent-service.ts';
import { keptHandedOf } from '../consent-tokens/kept-tokens.ts';
import { clockAt, type ClientRegistration, type FakeMcpServer } from '../testing/index.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import {
  postedToTheService,
  redeemedThrough,
  serviceCallsAt,
  studioSession,
  type ThroughAuto,
} from './auto-consents.ts';
import { servedThroughAuto } from './consent-servers.ts';
import { serveFakeConsentService } from './fake-consent-service.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function serving(changes: Partial<ClientRegistration> = {}): Promise<ThroughAuto> {
  const served = await servedThroughAuto(changes);
  closing.push(served.close);
  return served;
}

const verifier = 'a-handoff-verifier-of-forty-three-characters';

const aConnectionKey: unknown = expect.stringMatching(/^[\w-]{43}$/u);

function startOf(vendor: Pick<FakeMcpServer, 'origin'>, changes: Partial<ServiceStartAsked> = {}): ServiceStartAsked {
  return {
    issuer: vendor.origin,
    scope: 'files.read',
    parameters: { access_type: 'offline' },
    resource: `${vendor.origin}/mcp`,
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

describe('a handoff the fake consent service holds', () => {
  it('is taken once with the verifier its start was challenged with, and refused for another, after ten minutes or unknown', async () => {
    const serve = await serving();
    const calls = serviceCallsAt(serve.service);
    const { handle } = await redeemedAt(serve);
    const late = await redeemedAt(serve);
    const wrong = await run(calls.takeHandoff(handle, Redacted.make('another-verifier')));
    const taken = await run(calls.takeHandoff(handle, Redacted.make(verifier)));
    const again = await run(calls.takeHandoff(handle, Redacted.make(verifier)));
    serve.clock.setTo(600_000);

    expect([wrong, taken, again, await run(calls.takeHandoff(late.handle, Redacted.make(verifier)))]).toMatchObject([
      { failure: { refused: 'code' } },
      {
        success: {
          client_id: 'auto-runtime',
          tokens: { token_type: 'Bearer', scope: 'files.read', expires_at: '1970-01-01T01:00:00.000Z' },
          connection_key: aConnectionKey,
        },
      },
      { failure: { refused: 'code' } },
      { failure: { refused: 'code' } },
    ]);
    expect(await postedToTheService(serve.service, `/handoffs/${handle}`, 'not json')).toMatchObject({ status: 404 });
  });

  it('names a wrong verifier as one, with 403', async () => {
    const serve = await serving();
    const { handle } = await redeemedAt(serve);

    const answered = await postedToTheService(serve.service, `/handoffs/${handle}`, '{"verifier":"another"}');

    expect([answered.status, JSON.parse(answered.body)]).toMatchObject([403, { refused: 'wrong_verifier' }]);
  });
});

describe('the tokens the fake consent service refreshes and revokes', () => {
  it('are refused without the connection key the handoff gave, and refreshed or revoked with it, at the authorization server', async () => {
    const serve = await serving();
    const calls = serviceCallsAt(serve.service);
    const { handle } = await redeemedAt(serve);
    const handed = await Effect.runPromise(calls.takeHandoff(handle, Redacted.make(verifier)));
    const issuer = serve.fake.origin;
    const refreshToken = String(handed.tokens.refresh_token);
    const keyed = { issuer, refreshToken, connectionKey: handed.connection_key, resource: `${issuer}/mcp` };
    const kept = keptHandedOf(handed.tokens, handed.tokens.scope, handed.connection_key);
    const accessAlone = {
      access_token: kept.access_token,
      token_type: kept.token_type,
      connection_key: handed.connection_key,
    };

    const key = handed.connection_key;

    const unkeyed = await run(calls.refresh({ ...keyed, connectionKey: 'another-key' }));
    const refreshed = await run(calls.refresh({ ...keyed, resource: undefined }));
    serve.service.refuseNext('refresh');
    const refused = await run(calls.refresh(keyed));
    serve.service.refuseNext('revoke');
    const unrevoked = await run(calls.revoke({ issuer, tokens: kept, connectionKey: key }));
    const otherKey = await run(calls.revoke({ issuer, tokens: kept, connectionKey: 'another-key' }));
    const revoked = await run(calls.revoke({ issuer, tokens: accessAlone, connectionKey: key }));
    const afterwards = await run(calls.refresh(keyed));

    expect([unkeyed, refreshed, refused, unrevoked, otherKey, revoked, afterwards]).toMatchObject([
      { failure: { refused: 'unknown_key' } },
      { success: { token_type: 'Bearer', scope: 'files.read' } },
      { failure: { refused: 'invalid_grant' } },
      { failure: { refused: 'not_revoked', status: 503 } },
      { failure: { refused: 'unknown_key' } },
      { _tag: 'Success' },
      { failure: { refused: 'unknown_key' } },
    ]);
    expect([
      await postedToTheService(serve.service, '/tokens/revoke', '{}'),
      await postedToTheService(serve.service, '/tokens/refresh', '{}'),
    ]).toMatchObject([{ status: 400 }, { status: 400 }]);
  });
});

describe('the tokens the fake consent service refreshes for the authorization server', () => {
  it('are refused in the words of the authorization server where it refuses the refresh token', async () => {
    const serve = await serving();
    const calls = serviceCallsAt(serve.service);
    const handed = await Effect.runPromise(
      calls.takeHandoff((await redeemedAt(serve)).handle, Redacted.make(verifier)),
    );
    const issuer = serve.fake.origin;
    const refreshToken = 'a-refresh-token-nobody-issued';

    expect(
      await run(calls.refresh({ issuer, refreshToken, connectionKey: handed.connection_key, resource: undefined })),
    ).toMatchObject({ failure: { refused: 'invalid_grant' } });
  });
});

describe('the tokens of an authorization server that gives no expiry', () => {
  it('are handed off without one', async () => {
    const serve = await serving({ expiresInSeconds: null });
    const handed = await Effect.runPromise(
      serviceCallsAt(serve.service).takeHandoff((await redeemedAt(serve)).handle, Redacted.make(verifier)),
    );

    expect(Object.keys(handed.tokens)).toEqual(['access_token', 'refresh_token', 'scope', 'token_type']);
  });
});

async function failingVendor(): Promise<Pick<FakeMcpServer, 'origin'>> {
  const tokens = { access_token: 'a-token', refresh_token: 'a-refresh-token', token_type: 'Bearer', expires_in: 60 };
  const heard = { tokens: 0 };
  const vendor = await serveOnLoopback(() => (request) => {
    if (new URL(request.url).pathname === '/revoke') {
      return Promise.resolve(Response.json({ error: 'invalid_request' }, { status: 400 }));
    }
    heard.tokens += 1;
    return Promise.resolve(
      heard.tokens === 1 ? Response.json(tokens) : Response.json({ error: 'temporarily_unavailable' }, { status: 503 }),
    );
  });
  closing.push(vendor.close);
  return vendor;
}

describe('the calls of the fake consent service an authorization server fails', () => {
  it('are a 502 without a refusal where the server fails otherwise than by refusing, and not revoked in the status it answered', async () => {
    const vendor = await failingVendor();
    const service = await serveFakeConsentService({ vendor, now: clockAt(0).now });
    closing.push(service.close);
    const calls = serviceCallsAt(service);
    const first = await Effect.runPromise(calls.start(startOf(vendor)));
    const { handle } = await Effect.runPromise(calls.redeem(first.state, studioSession, { code: 'a-code' }));
    const handed = await Effect.runPromise(calls.takeHandoff(handle, Redacted.make(verifier)));
    const second = await Effect.runPromise(calls.start(startOf(vendor)));
    const issuer = vendor.origin;
    const connectionKey = handed.connection_key;

    expect([
      await run(calls.refresh({ issuer, refreshToken: 'a-refresh-token', connectionKey, resource: undefined })),
      await run(calls.revoke({ issuer, tokens: keptHandedOf(handed.tokens, undefined, connectionKey), connectionKey })),
      await run(calls.redeem(second.state, studioSession, { code: 'another-code' })),
    ]).toMatchObject([
      { failure: { refused: 'unanswered' } },
      { failure: { refused: 'not_revoked', status: 400 } },
      { failure: { refused: 'unanswered' } },
    ]);
    expect(
      service
        .calls()
        .map(({ path }) => path)
        .slice(-3),
    ).toEqual(['/tokens/refresh', '/tokens/revoke', `/consents/${second.state}/redeem`]);
  });
});
