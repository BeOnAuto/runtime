import { afterEach, describe, expect, it } from 'vitest';

import { type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';
import { basic, clientSecret, codeOf, metadataOf, redeemed, redirectUri } from './authorization-requests.ts';
import type { ClientRegistration } from './fake-clients.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function takingTheSecret(place: Partial<ClientRegistration>): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
    client: { clientId: 'auto-runtime', clientSecret, expiresInSeconds: 3600, redirectUris: [redirectUri], ...place },
  });
  closing.push(fake.close);
  return fake;
}

const inTheForm = { client_id: 'auto-runtime', client_secret: clientSecret };

const inTheBasicHeader = basic('auto-runtime', clientSecret);

async function methodsListedBy(fake: FakeMcpServer): Promise<readonly unknown[]> {
  const metadata = await metadataOf(fake);
  return [metadata['token_endpoint_auth_methods_supported'], metadata['revocation_endpoint_auth_methods_supported']];
}

describe('a fake that takes client secrets in the form alone', () => {
  it('refuses a secret in the Basic header, and lists no Basic method for its token or revocation endpoints', async () => {
    const fake = await takingTheSecret({ takesBasicSecrets: false, listsRevocationMethods: false });

    const answers = [
      await redeemed(fake, await codeOf(fake), inTheBasicHeader),
      await redeemed(fake, await codeOf(fake), {}, inTheForm),
    ];

    expect(answers.map(({ status }) => status)).toEqual([401, 200]);
    expect(await methodsListedBy(fake)).toEqual([['client_secret_post', 'private_key_jwt', 'none'], undefined]);
  });
});

describe('a fake that takes client secrets in the Basic header alone, as X’s token endpoint does', () => {
  it('refuses a secret in the form, and lists no method of the form for its token or revocation endpoints', async () => {
    const fake = await takingTheSecret({ takesPostedSecrets: false });

    const answers = [
      await redeemed(fake, await codeOf(fake), {}, inTheForm),
      await redeemed(fake, await codeOf(fake), inTheBasicHeader),
    ];

    expect(answers.map(({ status }) => status)).toEqual([401, 200]);
    expect(await methodsListedBy(fake)).toEqual([
      ['client_secret_basic', 'private_key_jwt', 'none'],
      ['client_secret_basic', 'private_key_jwt', 'none'],
    ]);
  });
});
