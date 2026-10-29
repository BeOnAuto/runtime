import { afterEach, describe, expect, it } from 'vitest';

import { type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';
import { clientSecret, codeOf, metadataOf, postedTo, redeemed, redirectUri } from './authorization-requests.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function takingNoChallenge(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
    client: {
      clientId: 'auto-runtime',
      clientSecret,
      expiresInSeconds: 3600,
      redirectUris: [redirectUri],
      takesNoChallenge: true,
    },
  });
  closing.push(fake.close);
  return fake;
}

const unchallenged = { code_challenge: undefined, code_challenge_method: undefined };

describe('the code of a fake that takes no challenge, as LinkedIn’s web endpoint does', () => {
  it('is granted asked without a challenge and redeemed without a verifier', async () => {
    const fake = await takingNoChallenge();
    const code = await codeOf(fake, unchallenged);

    const tokens = await postedTo(fake, '/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    expect(tokens).toMatchObject({ status: 200, body: { token_type: 'Bearer', scope: 'files.read' } });
    expect(await metadataOf(fake)).not.toHaveProperty('code_challenge_methods_supported');
  });

  it('is refused invalid_client, in LinkedIn’s words, where the client redeems it with a verifier', async () => {
    const fake = await takingNoChallenge();

    expect(await redeemed(fake, await codeOf(fake))).toEqual({
      status: 401,
      body: { error: 'invalid_client', error_description: 'Client authentication failed for the code' },
    });
  });
});
