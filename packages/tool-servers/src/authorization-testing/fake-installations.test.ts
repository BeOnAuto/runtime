import { afterEach, describe, expect, it } from 'vitest';

import { fakeMcpInProcess, inProcessFetch } from '../testing/index.ts';
import { clientSecret, codeOf, redeemed, redirectUri } from './authorization-requests.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

describe('the installations of the fake authorization server', () => {
  it('are listed, as it was given them, to a token it issued, and to no other', async () => {
    const installations = [{ id: 7, account: { name: 'acme' } }];
    const fake = fakeMcpInProcess({
      client: {
        clientId: 'auto-runtime',
        clientSecret,
        expiresInSeconds: 3600,
        redirectUris: [redirectUri],
        installationsAt: { path: '/user/installations', installations },
      },
    });
    closing.push(fake.close);
    const token = String((await redeemed(fake, await codeOf(fake))).body['access_token']);
    const listedTo = async (headers: Readonly<Record<string, string>>) => {
      const answer = await inProcessFetch(`${fake.origin}/user/installations`, { headers });
      return { status: answer.status, body: await answer.text() };
    };

    expect([
      await listedTo({ authorization: `Bearer ${token}` }),
      (await listedTo({ authorization: 'Bearer another-token' })).status,
      (await listedTo({})).status,
    ]).toEqual([{ status: 200, body: JSON.stringify({ installations }) }, 401, 401]);
  });
});

describe('the other answers of the fake authorization server to the person who signed in', () => {
  it('answer each path it was given, with its status and body, to a token it issued, and to no other', async () => {
    const fake = fakeMcpInProcess({
      client: {
        clientId: 'auto-runtime',
        clientSecret,
        expiresInSeconds: 3600,
        redirectUris: [redirectUri],
        answersToItsTokens: {
          '/me': { status: 200, body: { id: 7 } },
          '/me/memberships/acme': { status: 404, body: { message: 'Not Found' } },
        },
      },
    });
    closing.push(fake.close);
    const token = String((await redeemed(fake, await codeOf(fake))).body['access_token']);
    const answerAt = async (path: string, headers: Readonly<Record<string, string>>) => {
      const answer = await inProcessFetch(`${fake.origin}${path}`, { headers });
      return { status: answer.status, body: await answer.text() };
    };
    const withTheToken = { authorization: `Bearer ${token}` };

    expect([
      await answerAt('/me', withTheToken),
      await answerAt('/me/memberships/acme', withTheToken),
      (await answerAt('/me', { authorization: 'Bearer another-token' })).status,
    ]).toEqual([
      { status: 200, body: JSON.stringify({ id: 7 }) },
      { status: 404, body: JSON.stringify({ message: 'Not Found' }) },
      401,
    ]);
  });
});
