import { personIdOf } from '@on.auto/openid-connect';
import type { Asking, Browser } from '@on.auto/openid-connect/testing';
import { describe, expect, it } from 'vitest';

import {
  authorizationAskedBy,
  backFrom,
  bearer,
  fieldsOf,
  locationOf,
  publicUrl,
  refreshed,
  registered,
  signingIn,
  studio,
  subject,
  tokensExchanged,
  toTheProvider,
  type Running,
} from './signing-in.ts';

const inStudio = { clientId: studio.clientId, redirectUri: studio.redirectUri, scope: 'openid org:read org:write' };

interface SignedIn {
  readonly browser: Browser;
  readonly tokens: Readonly<Record<string, unknown>>;
}

async function signedInThroughStudio(
  signing: Running,
  who: string,
  idToken: Readonly<Record<string, unknown>> = {},
): Promise<SignedIn> {
  const browser = signing.aBrowser();
  const upstream = await toTheProvider(browser, inStudio);
  const resumed = await browser.at(
    locationOf(await backFrom(browser, signing.provider.signedIn(upstream, who, idToken))),
  );
  const code = new URL(locationOf(resumed)).searchParams.get('code') ?? '';
  return { browser, tokens: await tokensExchanged(browser, code, inStudio) };
}

async function tokenOf(
  signing: Running,
  who: string,
  idToken: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  return String((await signedInThroughStudio(signing, who, idToken)).tokens['access_token']);
}

interface Returned {
  readonly browser: Browser;
  readonly answer: Response;
}

async function returnedAs(signing: Running, query: (upstream: string) => string): Promise<Returned> {
  const browser = signing.aBrowser();
  const answer = await backFrom(browser, query(await toTheProvider(browser, { clientId: await registered(browser) })));
  return { browser, answer };
}

describe('a runtime that signs people in, as it decides who each is to it', () => {
  it('makes the first person to sign in the admin and the next a viewer, keeps each by id, and shows one an admin removed that they have no access', async () => {
    const signing = await signingIn({ provider: { idToken: { name: 'A colleague' } } });
    const [ada, priya] = ['Ada', 'Priya'].map((who) => personIdOf({ issuer: signing.provider.issuer, subject: who }));

    const asAda = bearer(await tokenOf(signing, 'Ada'));
    await tokenOf(signing, 'Priya');
    const listed = await fieldsOf(await signing.at('/v1/orgs/default/role-assignments', asAda));
    const removed = await signing.at(`/v1/orgs/default/role-assignments/${String(priya)}/viewer`, {
      ...asAda,
      method: 'DELETE',
    });
    const { answer: refused } = await returnedAs(signing, (upstream) => signing.provider.signedIn(upstream, 'Priya'));

    expect([removed.status, refused.status]).toEqual([200, 403]);
    const bothRecorded: unknown = expect.arrayContaining([
      expect.objectContaining({ principal: { type: 'person', id: ada }, source: 'bootstrap' }),
      expect.objectContaining({ principal: { type: 'person', id: priya }, source: 'enrolment' }),
    ]);
    expect(listed).toMatchObject({ role_assignments: bothRecorded });
    const bothKept: unknown = expect.arrayContaining([
      expect.objectContaining({ person: ada, name: 'A colleague' }),
      expect.objectContaining({ person: priya, name: 'A colleague' }),
    ]);
    expect(await signing.peopleKept()).toEqual(bothKept);
  });

  it('refuses a person whose ID Token lacks the claim OIDC_REQUIRED_CLAIM names before any role or record, and takes one who carries it', async () => {
    const signing = await signingIn({ settings: { OIDC_REQUIRED_CLAIM: 'tenant=acme' } });

    const lacking = await returnedAs(signing, (upstream) => signing.provider.signedIn(upstream, 'Priya'));
    const another = await returnedAs(signing, (upstream) =>
      signing.provider.signedIn(upstream, 'Priya', { tenant: 'Acme' }),
    );
    const keptOnceRefused = await signing.peopleKept();
    const carrying = await tokenOf(signing, 'Ada', { tenant: 'acme' });

    expect([lacking.answer.status, another.answer.status, keptOnceRefused]).toEqual([403, 403, []]);
    expect((await signing.at('/v1/orgs/default/role-assignments', bearer(carrying))).status).toBe(200);
  });
});

describe('a sign-in the provider does not complete', () => {
  it('sends the client access_denied where the person gave up at the provider, and shows a failure where the provider refused or the answer is not this sign-in', async () => {
    const signing = await signingIn();

    const gaveUp = await returnedAs(signing, (upstream) => signing.provider.refused(upstream, 'access_denied'));
    const refused = await returnedAs(signing, (upstream) => signing.provider.refused(upstream, 'server_error'));
    const tampered = await returnedAs(signing, (upstream) =>
      signing.provider.signedIn(upstream, subject).replace(/state=[\w-]+/u, 'state=another'),
    );
    const unstarted = await signing.at('/auth/oidc/callback?code=a&state=b');
    const backToTheAgent = new URL(locationOf(await gaveUp.browser.at(locationOf(gaveUp.answer))));

    expect([refused.answer.status, tampered.answer.status, unstarted.status]).toEqual([400, 400, 400]);
    expect(backToTheAgent.searchParams.get('error')).toBe('access_denied');
  });
});

interface Removed {
  readonly ada: SignedIn;
  readonly priya: SignedIn;
  readonly asAda: Asking;
  readonly priyasRole: string;
}

async function priyaRemoved(signing: Running): Promise<Removed> {
  const ada = await signedInThroughStudio(signing, 'Ada');
  const priya = await signedInThroughStudio(signing, 'Priya');
  const asAda = bearer(String(ada.tokens['access_token']));
  const priyasId = personIdOf({ issuer: signing.provider.issuer, subject: 'Priya' });
  const priyasRole = `/v1/orgs/default/role-assignments/${priyasId}/viewer`;
  await signing.at(priyasRole, { ...asAda, method: 'DELETE' });
  return { ada, priya, asAda, priyasRole };
}

function refreshedIn({ browser, tokens }: SignedIn): Promise<Response> {
  return refreshed(browser, studio.clientId, tokens['refresh_token']);
}

describe('a person an admin removed', () => {
  it('can no longer renew the access of their sign-in, where a member still can', async () => {
    const signing = await signingIn();
    const { ada, priya } = await priyaRemoved(signing);

    const [renewed, refused] = [await refreshedIn(ada), await refreshedIn(priya)];

    expect([renewed.status, refused.status, (await fieldsOf(refused))['error']]).toEqual([200, 400, 'invalid_grant']);
  });

  it('is sent to sign in again by a sign-in that has not ended, and is then shown they have no access', async () => {
    const signing = await signingIn();
    const { ada, priya } = await priyaRemoved(signing);

    const member = await ada.browser.at(authorizationAskedBy(inStudio));
    const asked = await priya.browser.at(authorizationAskedBy(inStudio));
    const upstream = locationOf(await priya.browser.at(locationOf(asked)));
    const back = await backFrom(priya.browser, signing.provider.signedIn(upstream, 'Priya'));

    expect([new URL(locationOf(member), publicUrl).origin, new URL(locationOf(asked), publicUrl).origin]).toEqual([
      new URL(studio.redirectUri).origin,
      publicUrl,
    ]);
    expect([new URL(upstream).origin, back.status]).toEqual([new URL(signing.provider.issuer).origin, 403]);
  });

  it('signs in again once an admin gives them a role again', async () => {
    const signing = await signingIn();
    const { asAda, priyasRole } = await priyaRemoved(signing);

    const given = await signing.at(priyasRole, { ...asAda, method: 'PUT' });
    const again = await tokenOf(signing, 'Priya');

    expect(given.status).toBe(200);
    expect((await signing.at('/v1/orgs/default/role-assignments', bearer(again))).status).toBe(200);
  });
});
