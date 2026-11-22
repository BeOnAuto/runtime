import { expect } from 'vitest';

import type { AccountLinking, LinkChoices, LinkShown, PageShown } from '../authorization-server/interaction-pages.ts';
import { backFromTheSignIn, locationOf, serversClosedAfterAll } from './agents-signing-in.ts';
import { browserAt, issuer, type Browser } from './authorization-server-over-http.ts';

export const openLink = 'Vq3n8m1Zr0aKbT7cW2yXhP5sLdE9gF4jUiO6tRwQ-Ak';

export const linkCookie = '__Host-Http-account-link';

export const linkingClient = 'account-linking';

export const ownRedirect = `${issuer}/account-links`;

export const named = { service: 'A chat', app: 'Auto' } as const;

type Heard = readonly unknown[];

export const aChallenge: unknown = expect.stringMatching(/^[\w-]{43}$/u);

export function choicesOf(consent: string) {
  return { allowAt: `${consent}/confirm`, denyAt: `${consent}/abort` };
}

export function allowPagesIn(pages: readonly PageShown[]): readonly PageShown[] {
  return pages.filter((page) => 'link' in page && 'allow' in page.link);
}

export function callsNamed(heard: readonly Heard[], ...names: readonly string[]): readonly Heard[] {
  return heard.filter(([call]) => names.includes(String(call)));
}

interface LinkingHeard {
  readonly linking: AccountLinking;
  readonly heard: () => readonly Heard[];
}

function linkingHeard(): LinkingHeard {
  const heard: Heard[] = [];
  const told = (call: Heard, page: LinkShown): Promise<LinkShown> => {
    heard.push(call);
    return Promise.resolve(page);
  };
  return {
    linking: {
      opened: (value) => {
        heard.push(['opened', value]);
        return Promise.resolve(value === openLink);
      },
      allowShown: (value, { allowAt, denyAt }: LinkChoices) =>
        told(['allowShown', value], {
          allow: { service: named.service, memberName: 'Dana', accountName: 'Northwind', allowAt, denyAt },
        }),
      allowed: (value, person) => told(['allowed', value, person], { code: { ...named, code: 'BCDFGH' } }),
      denied: (value) => told(['denied', value], { denied: named }),
    },
    heard: () => [...heard],
  };
}

export function linkingServersClosedAfterAll() {
  const aServer = serversClosedAfterAll();
  return {
    aServer,
    aLinkingServer: async () => {
      const heard = linkingHeard();
      const server = await aServer({ linking: heard.linking });
      return { server, heard, browser: browserAt(server) };
    },
  };
}

export async function toTheAllowPage(browser: Browser): Promise<string> {
  const toTheAuthorization = await browser.at(`/account-links/${openLink}`);
  const toTheInteraction = await browser.at(locationOf(toTheAuthorization));
  const toTheSignIn = await browser.at(locationOf(toTheInteraction));
  const consent = locationOf(await browser.at(locationOf(await backFromTheSignIn(browser, toTheSignIn))));
  await browser.at(consent);
  return consent;
}

export async function backAtTheServer(browser: Browser, consent: string, step: 'confirm' | 'abort'): Promise<string> {
  const decided = await browser.at(`${consent}/${step}`, { method: 'POST', headers: { origin: issuer } });
  return locationOf(await browser.at(locationOf(decided)));
}

export function stateCarriedBy(browser: Browser): string {
  return String(browser.cookies.get(linkCookie)?.split('.')[1]);
}
