import { afterEach, describe, expect, it } from 'vitest';

import { fakeMcpAnswers, type FakeMcpServer } from '../mcp-testing/fake-mcp-answers.ts';
import { serveFakeMcp } from '../mcp-testing/fake-mcp-server.ts';
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

async function servedTakingPublicClientsAlone(changes: Partial<ClientRegistration>): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({
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
    const open = await servedTakingPublicClientsAlone({});
    const confidential = await servedTakingPublicClientsAlone({ clientSecret });

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
