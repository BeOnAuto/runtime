import { personIdOf } from '@on.auto/openid-connect';
import { describe, expect, it } from 'vitest';

import { backFrom, locationOf, publicUrl, signingIn, subject } from '../sign-in/signing-in.ts';
import { accountLinksInMemory, namesFromTheServiceOf } from '../testing/account-linking/account-links-in-memory.ts';
import { linkStarted } from './account-linking.ts';
import { codeIn, secretOf } from './link-secrets.ts';

const dana = { account: 'T-northwind', member: 'U-dana' };

const names = namesFromTheServiceOf({
  services: { 'T-northwind': { service: 'A chat', app: 'Auto' } },
  members: { 'U-dana': { memberName: 'Dana Reyes', accountName: 'Northwind' } },
});

function codeOn(page: string): string {
  return /class="code">(?<code>\w+)</u.exec(page)?.groups?.['code'] ?? '';
}

function policyOf(answer: Readonly<Response>): string {
  return String(answer.headers.get('content-security-policy'));
}

describe('a link to an account, through a server that signs people in, over HTTP', () => {
  it('signs the person in, asks them to allow it on a page whose forms post to the server alone, and shows a code the server keeps under its own key', async () => {
    const accountLinks = accountLinksInMemory();
    const signing = await signingIn({ servedAlso: { accountLinks, namesFromTheService: names } });
    const browser = signing.aBrowser();
    const link = await linkStarted(accountLinks, publicUrl, dana);

    const toTheInteraction = await browser.at(locationOf(await browser.at(link)));
    const upstream = locationOf(await browser.at(locationOf(toTheInteraction)));
    const consent = locationOf(
      await browser.at(locationOf(await backFrom(browser, signing.provider.signedIn(upstream, subject)))),
    );
    const allowPage = await browser.at(consent);
    const decided = await browser.at(`${consent}/confirm`, { method: 'POST', headers: { origin: publicUrl } });
    const returnedTo = locationOf(await browser.at(locationOf(decided)));
    const codePage = await browser.at(returnedTo);
    const code = codeOn(await codePage.text());
    const again = await browser.at(link);

    const person = personIdOf({ issuer: signing.provider.issuer, subject });
    expect([allowPage.status, policyOf(allowPage)]).toEqual([200, expect.stringContaining("form-action 'self';")]);
    expect(returnedTo.startsWith(`${publicUrl}/account-links?`)).toBe(true);
    expect([codePage.status, codePage.headers.get('referrer-policy')]).toEqual([200, 'no-referrer']);
    expect(policyOf(codePage)).toMatch(/style-src 'sha256-[^']+' 'sha256-[^']+';/u);
    expect(again.status).toBe(404);
    const kept = await accountLinks.startOf(dana);
    expect([codeIn(code), kept?.person, kept?.secret === secretOf(code), kept?.secret.length]).toEqual([
      code,
      person,
      false,
      64,
    ]);
  });
});
