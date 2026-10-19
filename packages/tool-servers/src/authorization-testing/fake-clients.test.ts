import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign } from 'node:crypto';

import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { serveFakeMcp, type FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { serveOnLoopback } from '../testing/loopback-server.ts';
import {
  admitted,
  metadataOf,
  authorizeUrl,
  basic,
  clientSecret,
  codeOf,
  postedTo,
  redeemed,
  redirectUri,
  refreshed,
} from './authorization-requests.ts';
import type { ClientRegistration } from './fake-clients.ts';

const decodeBody = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

const aRegisteredSecret: unknown = expect.stringMatching(/^registered-secret-/u);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(client: ClientRegistration): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ client });
  closing.push(fake.close);
  return fake;
}

const withASecret: ClientRegistration = {
  clientId: 'auto-runtime',
  clientSecret,
  expiresInSeconds: 3600,
  redirectUris: [redirectUri],
};

const publicClient: ClientRegistration = {
  clientId: 'auto-runtime',
  expiresInSeconds: 3600,
  redirectUris: [redirectUri],
};

function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function encoded(part: object): string {
  return Buffer.from(JSON.stringify(part)).toString('base64url');
}

function assertionOf(subject: string, privateKey: string): Readonly<Record<string, string>> {
  const signed = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({ sub: subject, iss: subject })}`;
  const signature = sign('sha256', Buffer.from(signed), privateKey).toString('base64url');
  return {
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: `${signed}.${signature}`,
  };
}

describe('the clients of the fake and how they authenticate', () => {
  it('takes a client secret in the form as in the Basic header, and refuses another secret, none or an unknown client', async () => {
    const fake = await served(withASecret);

    const statuses = [
      await redeemed(fake, await codeOf(fake), {}, { client_id: 'auto-runtime', client_secret: clientSecret }),
      await redeemed(fake, await codeOf(fake), {}, { client_id: 'auto-runtime', client_secret: 'another-secret' }),
      await redeemed(fake, await codeOf(fake), {}, { client_id: 'auto-runtime' }),
      await redeemed(fake, await codeOf(fake), {}),
      await redeemed(fake, await codeOf(fake), basic('another-client', clientSecret)),
    ].map(({ status }) => status);

    expect(statuses).toEqual([200, 401, 401, 401, 401]);
  });

  it('takes an assertion signed by the key of the client it names, and refuses another key, client or a client without a key', async () => {
    const { publicKey, privateKey } = rsaKeys();
    const withAKey = await served({ ...publicClient, publicKey });
    const withoutAKey = await served(withASecret);
    const anotherKey = rsaKeys().privateKey;

    const statuses = [
      await redeemed(withAKey, await codeOf(withAKey), {}, assertionOf('auto-runtime', privateKey)),
      await redeemed(withAKey, await codeOf(withAKey), {}, assertionOf('auto-runtime', anotherKey)),
      await redeemed(withAKey, await codeOf(withAKey), {}, assertionOf('another-client', privateKey)),
      await redeemed(withoutAKey, await codeOf(withoutAKey), {}, assertionOf('auto-runtime', privateKey)),
    ].map(({ status }) => status);

    expect(statuses).toEqual([200, 401, 401, 401]);
  });

  it('takes a public client by its id alone, and refuses it a secret it does not have', async () => {
    const fake = await served(publicClient);

    const statuses = [
      await redeemed(fake, await codeOf(fake), {}, { client_id: 'auto-runtime' }),
      await redeemed(fake, await codeOf(fake), basic('auto-runtime', 'any-secret')),
      await redeemed(fake, await codeOf(fake), {}, { client_id: 'auto-runtime', client_secret: 'any-secret' }),
    ].map(({ status }) => status);

    expect(statuses).toEqual([200, 401, 401]);
  });
});

async function registeredAt(
  fake: FakeMcpServer,
  metadata: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const answer = await fetch(`${fake.origin}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  return { status: answer.status, body: decodeBody(await answer.json()) };
}

describe('the client credentials the fake grants', () => {
  it('are granted to a client that authenticates in any way it advertises, and to no public client', async () => {
    const confidential = await served(withASecret);
    const open = await served(publicClient);
    const asked = { grant_type: 'client_credentials' };

    const answers = [
      await postedTo(confidential, '/token', asked),
      await postedTo(confidential, '/token', { ...asked, client_id: 'auto-runtime', client_secret: clientSecret }, {}),
      await postedTo(confidential, '/token', asked, basic('auto-runtime', 'another-secret')),
      await postedTo(open, '/token', { ...asked, client_id: 'auto-runtime' }, {}),
    ];

    expect(answers.map(({ status, body }) => [status, body['error']])).toEqual([
      [200, undefined],
      [200, undefined],
      [401, 'invalid_client'],
      [400, 'unauthorized_client'],
    ]);
    expect(await admitted(confidential, answers[1]?.body['access_token'])).toBe(true);
  });
});

describe('the dynamic registration of the fake', () => {
  it('registers a client where the test asks, with a secret unless it authenticates with none, whose codes it redeems', async () => {
    const fake = await served({ ...withASecret, dynamicRegistration: true });

    const confidential = await registeredAt(fake, { redirect_uris: [redirectUri], client_name: 'Auto' });
    const open = await registeredAt(fake, { redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });
    const clientId = String(confidential.body['client_id']);

    expect((await metadataOf(fake))['registration_endpoint']).toBe(`${fake.origin}/register`);
    expect(confidential).toMatchObject({
      status: 201,
      body: {
        client_id: 'registered-1',
        client_secret: aRegisteredSecret,
        client_secret_expires_at: 0,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code', 'refresh_token'],
      },
    });
    expect(open.body).not.toHaveProperty('client_secret');
    expect(
      (
        await redeemed(
          fake,
          await codeOf(fake, { client_id: clientId }),
          basic(clientId, String(confidential.body['client_secret'])),
        )
      ).status,
    ).toBe(200);
    expect(
      (await redeemed(fake, await codeOf(fake, { client_id: 'registered-2' }), {}, { client_id: 'registered-2' }))
        .status,
    ).toBe(200);
  });

  it('refuses a registration without its redirect URIs, and offers none where the test does not ask', async () => {
    const offering = await served({ ...withASecret, dynamicRegistration: true });
    const withholding = await served(withASecret);

    expect(await registeredAt(offering, { client_name: 'Auto' })).toEqual({
      status: 400,
      body: { error: 'invalid_client_metadata', error_description: 'Expected redirect_uris' },
    });
    expect(await metadataOf(withholding)).not.toHaveProperty('registration_endpoint');
    expect((await fetch(`${withholding.origin}/register`, { method: 'POST' })).status).toBe(401);
  });
});

describe('the clients a fake registers dynamically', () => {
  it('keep the codes and the tokens of one client from another', async () => {
    const fake = await served({ ...withASecret, dynamicRegistration: true });
    const other = await registeredAt(fake, { redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });
    const asOther = { client_id: String(other.body['client_id']) };
    const granted = (await redeemed(fake, await codeOf(fake))).body;

    const answers = [
      await redeemed(fake, await codeOf(fake), {}, asOther),
      await postedTo(
        fake,
        '/token',
        { grant_type: 'refresh_token', refresh_token: String(granted['refresh_token']), ...asOther },
        {},
      ),
      await postedTo(fake, '/revoke', { token: String(granted['refresh_token']), ...asOther }, {}),
      await postedTo(fake, '/revoke', { token: String(granted['access_token']), ...asOther }, {}),
    ];

    expect(answers.map(({ status, body }) => [status, body])).toEqual([
      [400, { error: 'invalid_grant' }],
      [400, { error: 'invalid_grant' }],
      [200, {}],
      [200, {}],
    ]);
    expect(await admitted(fake, granted['access_token'])).toBe(true);
    expect((await refreshed(fake, String(granted['refresh_token']))).status).toBe(200);
  });
});

async function documents(): Promise<string> {
  const listening = await serveOnLoopback((origin) => (request) => {
    const { pathname } = new URL(request.url);
    const documented: Readonly<Record<string, unknown>> = {
      '/client.json': { client_id: `${origin}/client.json`, redirect_uris: [redirectUri] },
      '/another.json': { client_id: `${origin}/client.json`, redirect_uris: [redirectUri] },
      '/broken.json': { client_id: `${origin}/broken.json` },
    };
    const document = documented[pathname];
    return Promise.resolve(document === undefined ? new Response(null, { status: 404 }) : Response.json(document));
  });
  closing.push(listening.close);
  return listening.origin;
}

describe('the client metadata documents of the fake', () => {
  it('takes a client by its document where the test asks and advertises it, as a public client', async () => {
    const fake = await served({ ...withASecret, clientMetadataDocuments: true });
    const clientId = `${await documents()}/client.json`;

    const code = await codeOf(fake, { client_id: clientId });

    expect((await metadataOf(fake))['client_id_metadata_document_supported']).toBe(true);
    expect((await redeemed(fake, code, {}, { client_id: clientId })).status).toBe(200);
  });

  it('takes no client whose document names another id, misses its redirect URIs or is missing, nor one that is no address', async () => {
    const fake = await served({ ...withASecret, clientMetadataDocuments: true });
    const origin = await documents();

    const statuses = await Promise.all(
      [`${origin}/another.json`, `${origin}/broken.json`, `${origin}/missing.json`, 'not-an-address'].map(
        async (clientId) => (await fetch(authorizeUrl(fake, { client_id: clientId }), { redirect: 'manual' })).status,
      ),
    );

    expect(statuses).toEqual([400, 400, 400, 400]);
  });

  it('takes no client by its document where the test does not ask, and advertises none', async () => {
    const fake = await served(withASecret);
    const clientId = `${await documents()}/client.json`;

    expect(await metadataOf(fake)).not.toHaveProperty('client_id_metadata_document_supported');
    expect((await fetch(authorizeUrl(fake, { client_id: clientId }), { redirect: 'manual' })).status).toBe(400);
  });
});
