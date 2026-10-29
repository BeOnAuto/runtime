import { Effect, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { admitted } from '../authorization-testing/authorization-requests.ts';
import type { ConsentClient, FinishedConsent, HandleFinishAsked } from '../consent/consent-client.ts';
import {
  consentClientThrough,
  consentClientWith,
  handedOffAskedOf,
  startAskedAt,
  tokensKeptBy,
  type ClientRegistration,
} from '../testing/index.ts';
import { servedThroughAuto, type ThroughAuto } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function throughAuto(changes: Partial<ClientRegistration> = {}): Promise<ThroughAuto> {
  const serving = await servedThroughAuto(changes);
  closing.push(serving.close);
  return serving;
}

function finished(client: ConsentClient, asked: HandleFinishAsked): Promise<FinishedConsent> {
  return Effect.runPromise(client.finish(asked));
}

function refused(client: ConsentClient, asked: HandleFinishAsked) {
  return Effect.runPromise(Effect.flip(client.finish(asked)));
}

function handedOffAt(serving: ThroughAuto, client: ConsentClient = consentClientThrough(serving)) {
  return handedOffAskedOf(client, startAskedAt(serving.fake), serving.service);
}

function heardAt({ service }: Pick<ThroughAuto, 'service'>, path: string): number {
  return service.calls().filter((call) => call.path.startsWith(path)).length;
}

const aToken: unknown = expect.stringMatching(/^token-/u);

const aRefreshToken: unknown = expect.stringMatching(/^refresh-/u);

const aConnectionKey: unknown = expect.stringMatching(/^[\w-]{43}$/u);

describe('the finish of a consent through Auto’s consent service', () => {
  it('takes the handoff with the verifier of its start, and answers the tokens with the connection key inside them', async () => {
    const serving = await throughAuto();
    const client = consentClientThrough(serving);
    const asked = await handedOffAt(serving, client);

    const done = await finished(client, asked);
    const kept = tokensKeptBy(done);

    expect(kept).toEqual({
      access_token: aToken,
      refresh_token: aRefreshToken,
      expires_at: '1970-01-01T01:00:00.000Z',
      scope: 'files.read',
      token_type: 'Bearer',
      connection_key: aConnectionKey,
    });
    expect([done.scope, await admitted(serving.fake, kept.access_token)]).toEqual(['files.read', true]);
    expect(serving.service.calls().at(-1)).toMatchObject({ body: { verifier: Redacted.value(asked.verifier) } });
    expect(JSON.stringify(done)).not.toContain(String(kept.connection_key));
  });

  it('answers the client the service redeemed with, which the handoff names, whatever the start recorded', async () => {
    const serving = await throughAuto();
    const client = consentClientThrough(serving);
    const asked = await handedOffAt(serving, client);

    const done = await finished(client, {
      ...asked,
      client: { client_id: 'a-client-listed-before', client_source: 'auto' },
    });

    expect(done.client).toEqual({ client_id: 'auto-runtime', client_source: 'auto' });
  });

  it('keeps no refresh token and no end where the authorization server gives neither', async () => {
    const serving = await throughAuto({ issuesRefreshTokens: false, expiresInSeconds: null });
    const client = consentClientThrough(serving);

    const done = await finished(client, await handedOffAt(serving, client));

    expect(Object.keys(tokensKeptBy(done))).toEqual(['access_token', 'scope', 'token_type', 'connection_key']);
  });
});

describe('the tokens Auto’s consent service hands on', () => {
  it('are kept as a bearer token where they name no token_type', async () => {
    const serving = await throughAuto({ namesTokenType: false });
    const client = consentClientThrough(serving);

    const done = await finished(client, await handedOffAt(serving, client));

    expect(tokensKeptBy(done).token_type).toBe('Bearer');
  });
});

describe('the handoff of a finish through Auto’s consent service', () => {
  it('is taken once, and refused for another verifier and once its ten minutes are over', async () => {
    const serving = await throughAuto();
    const client = consentClientThrough(serving);
    const asked = await handedOffAt(serving, client);
    const late = await handedOffAt(serving, client);
    const otherVerifier = Redacted.make('another-verifier-of-forty-three-characters-long');

    const wrong = await refused(client, { ...asked, verifier: otherVerifier });
    const taken = await finished(client, asked);
    const again = await refused(client, asked);
    serving.clock.setTo(600_000);

    expect([wrong, again, await refused(client, late)]).toEqual([
      { refused: 'code' },
      { refused: 'code' },
      { refused: 'code' },
    ]);
    expect(tokensKeptBy(taken).token_type).toBe('Bearer');
  });

  it('is refused as gone, and not taken, where the source of Auto is off or the start was not made with its client', async () => {
    const serving = await throughAuto();
    const asked = await handedOffAt(serving);
    const registered: HandleFinishAsked = {
      ...asked,
      client: { client_id: 'auto-runtime', client_source: 'registered' },
    };

    expect([
      await refused(consentClientWith(), asked),
      await refused(consentClientThrough(serving), registered),
    ]).toEqual([{ refused: 'client_gone' }, { refused: 'client_gone' }]);
    expect(heardAt(serving, '/handoffs/')).toBe(0);
  });
});

describe('the tokens a finish through Auto’s consent service takes', () => {
  it('are revoked through the service where the server grants none of the scopes asked', async () => {
    const serving = await throughAuto({ grantedScope: '' });
    const client = consentClientThrough(serving);

    expect(await refused(client, await handedOffAt(serving, client))).toEqual({ refused: 'no_scope' });
    expect([
      heardAt(serving, '/tokens/revoke'),
      serving.fake.heard().filter(({ path }) => path === '/revoke').length,
    ]).toEqual([1, 1]);
  });

  it('are revoked through the service by the revocation the finish offers', async () => {
    const serving = await throughAuto();
    const client = consentClientThrough(serving);
    const done = await finished(client, await handedOffAt(serving, client));

    await Effect.runPromise(done.revoked);

    expect([heardAt(serving, '/tokens/revoke'), await admitted(serving.fake, tokensKeptBy(done).access_token)]).toEqual(
      [1, false],
    );
  });
});
