import { Schema } from 'effect';
import { importPKCS8, SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { fakeMcpAnswers, type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { fakeMcpInProcess, inProcessFetch } from '../testing/index.ts';
import { rsaKeys } from '../testing/token-sources.ts';
import {
  asTheClient,
  basic,
  clientSecret,
  codeOf,
  metadataOf,
  redeemed,
  redirectUri,
} from './authorization-requests.ts';
import type { ClientRegistration } from './fake-clients.ts';

const origin = 'https://vendor.example.com';

const handler = fakeMcpAnswers({
  client: { clientId: 'auto-runtime', clientSecret, expiresInSeconds: 3600, redirectUris: [redirectUri] },
}).handlerAt(origin);

function formNeverReadAsText(path: string, form: Readonly<Record<string, string>>): Request {
  const request = new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...asTheClient },
    body: new URLSearchParams(form),
  });
  return Object.defineProperty(request, 'text', {
    value: () => Promise.reject(new TypeError('The body of a form was read as text')),
  });
}

async function answered(answer: Response) {
  return { status: answer.status, body: await answer.text() };
}

describe('the token and revocation endpoints of the fake authorization server', () => {
  it('read a form as a form, never asking its body for text, which a platform warns of for a body that is a form', async () => {
    const refreshed = await handler(
      formNeverReadAsText('/token', { grant_type: 'refresh_token', refresh_token: 'refresh-unknown' }),
    );
    const revoked = await handler(formNeverReadAsText('/revoke', { token: 'token-unknown' }));

    expect([await answered(refreshed), revoked.status]).toEqual([
      { status: 400, body: JSON.stringify({ error: 'invalid_grant' }) },
      200,
    ]);
  });
});

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function servedTakingPublicClientsAlone(changes: Partial<ClientRegistration>): FakeMcpServer {
  const fake = fakeMcpInProcess({
    client: {
      clientId: 'auto-runtime',
      expiresInSeconds: 3600,
      redirectUris: [redirectUri],
      takesPublicClientsAlone: true,
      ...changes,
    },
  });
  closing.push(fake.close);
  return fake;
}

describe('a fake whose token endpoint takes public clients alone', () => {
  it('lists none alone, takes a public client by its id, and refuses a client with a secret however it sends it, and one it does not know', async () => {
    const open = servedTakingPublicClientsAlone({});
    const confidential = servedTakingPublicClientsAlone({ clientSecret });

    const statuses = [
      await redeemed(open, await codeOf(open), {}, { client_id: 'auto-runtime' }),
      await redeemed(open, await codeOf(open), {}, { client_id: 'another-client' }),
      await redeemed(confidential, await codeOf(confidential), basic('auto-runtime', clientSecret)),
      await redeemed(
        confidential,
        await codeOf(confidential),
        {},
        { client_id: 'auto-runtime', client_secret: clientSecret },
      ),
    ].map(({ status }) => status);

    expect(statuses).toEqual([200, 401, 401, 401]);
    expect((await metadataOf(open))['token_endpoint_auth_methods_supported']).toEqual(['none']);
  });
});

const placesOfTheMetadata: readonly (readonly [string, Partial<ClientRegistration>, string])[] = [
  ['RFC 8414 places its metadata', {}, '/.well-known/oauth-authorization-server/tenant-1/v2.0'],
  [
    'OpenID Connect Discovery places its configuration',
    { openIdConnect: true },
    '/tenant-1/v2.0/.well-known/openid-configuration',
  ],
];

const assertingOrigin = 'https://issuer.example.com';

const errorOf = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.optionalKey(Schema.String) }));

const asserting = rsaKeys();

const robot = { clientId: 'robot', publicKey: asserting.publicKey, expiresInSeconds: 3600 };

interface Asserted {
  readonly registration?: ClientRegistration;
  readonly privateKey?: string;
  readonly alg?: string;
  readonly sub?: string | null;
  readonly aud?: string;
  readonly lastsSeconds?: number;
  readonly asserted?: (signed: string) => Readonly<Record<string, string>>;
}

async function assertionAnswered({
  registration = { ...robot, subjects: ['inbox'] },
  privateKey = asserting.privateKey,
  alg = 'RS256',
  sub = 'inbox',
  aud = `${assertingOrigin}/token`,
  lastsSeconds = 300,
  asserted = (signed) => ({ assertion: signed }),
}: Asserted) {
  const signed = await new SignJWT(sub === null ? {} : { sub })
    .setProtectedHeader({ alg })
    .setIssuer('robot')
    .setAudience(aud)
    .setIssuedAt(1_800_000_000)
    .setExpirationTime(1_800_000_000 + lastsSeconds)
    .sign(await importPKCS8(privateKey, alg));
  const answer = await fakeMcpAnswers({ client: registration }).handlerAt(assertingOrigin)(
    new Request(`${assertingOrigin}/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', ...asserted(signed) }),
    }),
  );
  return [answer.status, errorOf(await answer.json()).error ?? 'token'];
}

describe('the token endpoint of a fake that takes a signed assertion', () => {
  it('grants a token to an assertion its client signed for that endpoint and a subject it may act as, or for the client itself where it names none, and refuses any other as the service does', async () => {
    expect(
      await Promise.all([
        assertionAnswered({}),
        assertionAnswered({ registration: robot, sub: 'ceo' }),
        assertionAnswered({ sub: null }),
        assertionAnswered({ registration: { ...robot, subjects: [] }, sub: null }),
        assertionAnswered({ privateKey: rsaKeys().privateKey }),
        assertionAnswered({
          registration: { clientId: 'robot', clientSecret: 'robot-secret', expiresInSeconds: 3600 },
        }),
        assertionAnswered({ alg: 'RS384' }),
        assertionAnswered({ asserted: (signed) => ({ assertion: signed.split('.').slice(0, 2).join('.') }) }),
        assertionAnswered({ asserted: () => ({}) }),
        assertionAnswered({ aud: 'https://elsewhere.example.com/token' }),
        assertionAnswered({ lastsSeconds: 3601 }),
        assertionAnswered({ sub: 'ceo' }),
      ]),
    ).toEqual([
      [200, 'token'],
      [200, 'token'],
      [200, 'token'],
      [200, 'token'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [400, 'invalid_grant'],
      [401, 'unauthorized_client'],
    ]);
  });
});

describe('a fake whose issuer has a path in its address, as an authorization server of one tenant has', () => {
  it.each(placesOfTheMetadata)(
    'answers where %s for that issuer, naming the issuer with its path, and nowhere else',
    async (_case, changes, path) => {
      const fake = servedTakingPublicClientsAlone({ issuerPath: '/tenant-1/v2.0', ...changes });
      const named = await inProcessFetch(`${fake.origin}${path}`);
      const atTheRoot = await inProcessFetch(`${fake.origin}/.well-known/oauth-authorization-server`);

      expect([named.status, atTheRoot.ok]).toEqual([200, false]);
      expect(await named.json()).toMatchObject({ issuer: `${fake.origin}/tenant-1/v2.0` });
    },
  );
});
