import { describe, expect, it } from 'vitest';

import { fakeMcpAnswers } from '../mcp-testing/fake-mcp-answers.ts';
import { asTheClient, clientSecret, redirectUri } from './authorization-requests.ts';

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
