import { createHash } from 'node:crypto';

import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientRegistration } from '../authorization-testing/fake-clients.ts';
import type { ServiceStartAsked } from '../consent/consent-service.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import {
  postedToTheService,
  redeemedThrough,
  servedThroughAuto,
  serviceCallsAt,
  type ThroughAuto,
} from './auto-consents.ts';

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
    const kept = { ...handed.tokens, connection_key: handed.connection_key };
    const accessAlone = {
      access_token: kept.access_token,
      token_type: kept.token_type,
      connection_key: kept.connection_key,
    };

    const unkeyed = await run(calls.refresh({ ...keyed, connectionKey: 'another-key' }));
    const refreshed = await run(calls.refresh({ ...keyed, resource: undefined }));
    serve.service.refuseNext('refresh');
    const refused = await run(calls.refresh(keyed));
    serve.service.refuseNext('revoke');
    const unrevoked = await run(calls.revoke({ issuer, tokens: kept }));
    const otherKey = await run(calls.revoke({ issuer, tokens: { ...kept, connection_key: 'another-key' } }));
    const revoked = await run(calls.revoke({ issuer, tokens: accessAlone }));
    const afterwards = await run(calls.refresh(keyed));

    expect([unkeyed, refreshed, refused, unrevoked, otherKey, revoked, afterwards]).toMatchObject([
      { failure: { refused: 'invalid_grant' } },
      { success: { token_type: 'Bearer', scope: 'files.read' } },
      { failure: { refused: 'invalid_grant' } },
      { failure: { refused: 'not_revoked', status: 502 } },
      { failure: { refused: 'not_revoked', status: 403 } },
      { _tag: 'Success' },
      { failure: { refused: 'invalid_grant' } },
    ]);
    expect([
      await postedToTheService(serve.service, '/tokens/revoke', '{}'),
      await postedToTheService(serve.service, '/tokens/refresh', '{}'),
    ]).toMatchObject([{ status: 403 }, { status: 403 }]);
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
