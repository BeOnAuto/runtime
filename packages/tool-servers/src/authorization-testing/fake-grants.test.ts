import { afterEach, describe, expect, it } from 'vitest';

import { type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';
import {
  admitted,
  asTheClient,
  authorizeUrl,
  basic,
  clientSecret,
  codeOf,
  metadataOf,
  consentAt,
  postedTo,
  redeemed,
  redirectUri,
  refreshed,
} from './authorization-requests.ts';
import type { ClientRegistration } from './fake-clients.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
    client: { clientId: 'auto-runtime', clientSecret, expiresInSeconds: 3600, redirectUris: [redirectUri], ...changes },
  });
  closing.push(fake.close);
  return fake;
}

const aToken: unknown = expect.stringMatching(/^token-\d+-/u);

const aRefreshToken: unknown = expect.stringMatching(/^refresh-/u);

const aCode: unknown = expect.stringMatching(/^code-/u);

type Changes = Readonly<Record<string, string | undefined>>;

describe('the authorization code the fake grants', () => {
  it('sends the person back with a code, the state and its issuer, and redeems the code once, with its verifier, for tokens', async () => {
    const fake = await served();

    const back = await consentAt(fake);
    const code = String(back.searchParams.get('code'));
    const tokens = await redeemed(fake, code);
    const again = await redeemed(fake, code);

    expect(`${back.origin}${back.pathname}`).toBe(redirectUri);
    expect(Object.fromEntries(back.searchParams)).toEqual({
      code: aCode,
      state: 'state-1',
      iss: fake.origin,
    });
    expect(tokens).toEqual({
      status: 200,
      body: {
        access_token: aToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: aRefreshToken,
        scope: 'files.read',
      },
    });
    expect(await admitted(fake, tokens.body['access_token'])).toBe(true);
    expect(again).toEqual({ status: 400, body: { error: 'invalid_grant' } });
    expect(fake.tokenRequests()).toBe(2);
  });

  it('grants a consent asked without a state or a scope, and answers its tokens without a scope', async () => {
    const fake = await served({ expiresInSeconds: null });

    const back = await consentAt(fake, { state: undefined, scope: undefined });
    const tokens = await redeemed(fake, String(back.searchParams.get('code')));

    expect([...back.searchParams.keys()]).toEqual(['code', 'iss']);
    expect(tokens.body).toEqual({ access_token: aToken, token_type: 'Bearer', refresh_token: aRefreshToken });
  });
});

describe('the codes the fake does not redeem', () => {
  it('are those given with another verifier, another redirect URI, no verifier or no code', async () => {
    const fake = await served();

    const answers = [
      await redeemed(fake, await codeOf(fake), asTheClient, { code_verifier: 'another-verifier' }),
      await redeemed(fake, await codeOf(fake), asTheClient, { redirect_uri: 'https://studio.example.com/elsewhere' }),
      await postedTo(fake, '/token', {
        grant_type: 'authorization_code',
        code: await codeOf(fake),
        redirect_uri: redirectUri,
      }),
      await postedTo(fake, '/token', { grant_type: 'authorization_code' }),
    ];

    expect(answers.map(({ status, body }) => [status, body['error']])).toEqual([
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
    ]);
  });
});

describe('the consent the fake refuses', () => {
  it('sends the person back with the error of a consent asked for another response or without a challenge of S256', async () => {
    const fake = await served();
    const asked: readonly Changes[] = [
      { response_type: 'token' },
      { code_challenge: undefined },
      { code_challenge_method: 'plain' },
      { code_challenge_method: 'plain', state: undefined },
    ];

    const errors = await Promise.all(
      asked.map(async (changes) => Object.fromEntries((await consentAt(fake, changes)).searchParams)),
    );

    expect(errors).toEqual([
      { error: 'unsupported_response_type', state: 'state-1', iss: fake.origin },
      { error: 'invalid_request', state: 'state-1', iss: fake.origin },
      { error: 'invalid_request', state: 'state-1', iss: fake.origin },
      { error: 'invalid_request', iss: fake.origin },
    ]);
  });

  it('answers a consent of a client or a redirect URI it does not know on its own page, sending the person nowhere', async () => {
    const fake = await served();

    const asked: readonly Changes[] = [
      { client_id: 'another-client' },
      { client_id: undefined },
      { redirect_uri: 'https://elsewhere.example.com/' },
      { redirect_uri: undefined },
    ];

    const answers = await Promise.all(
      asked.map(async (changes) => {
        const answer = await fetch(authorizeUrl(fake, changes), { redirect: 'manual' });
        return [answer.status, answer.headers.get('location'), await answer.json()];
      }),
    );

    expect(answers).toEqual(
      Array.from({ length: 4 }, () => [
        400,
        null,
        { error: 'invalid_request', error_description: 'The client or its redirect URI is unknown here' },
      ]),
    );
  });
});

async function grantedTokens(fake: FakeMcpServer) {
  const { body } = await redeemed(fake, await codeOf(fake));
  return { accessToken: String(body['access_token']), refreshToken: String(body['refresh_token']) };
}

describe('the metadata of the fake', () => {
  it('says what it grants, how its clients authenticate and where it revokes, and offers no more than the test asks', async () => {
    const fake = await served();
    const methods = ['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'none'];

    expect(await metadataOf(fake)).toEqual({
      issuer: fake.origin,
      authorization_endpoint: `${fake.origin}/authorize`,
      token_endpoint: `${fake.origin}/token`,
      revocation_endpoint: `${fake.origin}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['client_credentials', 'authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: methods,
      token_endpoint_auth_signing_alg_values_supported: ['RS256'],
      revocation_endpoint_auth_methods_supported: methods,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe('the refresh tokens the fake grants', () => {
  it('refresh the tokens of a grant, and are kept as they are unless the test asks for rotation', async () => {
    const fake = await served();
    const { refreshToken } = await grantedTokens(fake);

    const first = await refreshed(fake, refreshToken);
    const second = await refreshed(fake, refreshToken);

    expect([first, second]).toEqual([
      { status: 200, body: { access_token: aToken, token_type: 'Bearer', expires_in: 3600, scope: 'files.read' } },
      { status: 200, body: { access_token: aToken, token_type: 'Bearer', expires_in: 3600, scope: 'files.read' } },
    ]);
    expect(await admitted(fake, second.body['access_token'])).toBe(true);
  });

  it('are refused unknown, absent or presented by a client that does not authenticate', async () => {
    const fake = await served();
    const { refreshToken } = await grantedTokens(fake);

    const answers = [
      await refreshed(fake, 'refresh-unknown'),
      await postedTo(fake, '/token', { grant_type: 'refresh_token' }),
      await refreshed(fake, refreshToken, basic('auto-runtime', 'another-secret')),
      await postedTo(fake, '/token', { grant_type: 'password' }),
      await postedTo(fake, '/token', {}),
    ];

    expect(answers).toEqual([
      { status: 400, body: { error: 'invalid_grant' } },
      { status: 400, body: { error: 'invalid_grant' } },
      { status: 401, body: { error: 'invalid_client' } },
      { status: 400, body: { error: 'unsupported_grant_type' } },
      { status: 400, body: { error: 'unsupported_grant_type' } },
    ]);
  });
});

describe('the rotation of the refresh tokens the fake grants', () => {
  it('is made on request, and a rotated token used again ends its grant', async () => {
    const fake = await served({ rotatesRefreshTokens: true });
    const { accessToken, refreshToken } = await grantedTokens(fake);

    const rotated = await refreshed(fake, refreshToken);
    const reused = await refreshed(fake, refreshToken);
    const afterReuse = await refreshed(fake, String(rotated.body['refresh_token']));

    expect(rotated).toEqual({
      status: 200,
      body: {
        access_token: aToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: aRefreshToken,
        scope: 'files.read',
      },
    });
    expect(rotated.body['refresh_token']).not.toBe(refreshToken);
    expect([reused.body, afterReuse.body]).toEqual([{ error: 'invalid_grant' }, { error: 'invalid_grant' }]);
    expect([await admitted(fake, accessToken), await admitted(fake, rotated.body['access_token'])]).toEqual([
      false,
      false,
    ]);
  });
});

describe('the revocation endpoint of the fake', () => {
  it('revokes an access token alone, and a refresh token with every token of its grant', async () => {
    const fake = await served();
    const { accessToken, refreshToken } = await grantedTokens(fake);
    const later = await grantedTokens(fake);

    const revokedAccess = await postedTo(fake, '/revoke', { token: accessToken });
    const stillRefreshed = await refreshed(fake, refreshToken);
    const revokedRefresh = await postedTo(fake, '/revoke', { token: later.refreshToken });

    expect([revokedAccess, revokedRefresh]).toEqual([
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    expect(stillRefreshed.status).toBe(200);
    expect([await admitted(fake, accessToken), await admitted(fake, later.accessToken)]).toEqual([false, false]);
    expect((await refreshed(fake, later.refreshToken)).body).toEqual({ error: 'invalid_grant' });
  });

  it('answers a token it does not know, or none, as revoked, and refuses a client that does not authenticate', async () => {
    const fake = await served();

    expect([
      await postedTo(fake, '/revoke', { token: 'token-unknown' }),
      await postedTo(fake, '/revoke', {}),
      await postedTo(fake, '/revoke', { token: 'token-unknown' }, basic('auto-runtime', 'another-secret')),
    ]).toEqual([
      { status: 200, body: {} },
      { status: 200, body: {} },
      { status: 401, body: { error: 'invalid_client' } },
    ]);
  });
});
