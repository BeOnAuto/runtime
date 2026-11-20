import { describe, expect, it } from 'vitest';

import {
  backFromTheSignIn,
  locationOf,
  registered,
  serversClosedAfterAll,
  signedInAs,
  signInBegun,
} from '../testing/agents-signing-in.ts';
import {
  browserAt,
  pendingInvitationSecret,
  signingIn,
  studioOpenedAt,
} from '../testing/authorization-server-over-http.ts';
import type { InteractionSignIn } from './interaction-pages.ts';

const aServer = serversClosedAfterAll();

const invitationCookie = '__Host-Http-invitation';

interface CarriedTo {
  readonly signIn: InteractionSignIn;
  readonly carried: () => readonly (string | undefined)[];
}

function carriedTo(outcome = signingIn.finished): CarriedTo {
  const carried: (string | undefined)[] = [];
  return {
    signIn: {
      ...signingIn,
      finished: (query, pending, invitation) => {
        carried.push(invitation);
        return outcome(query, pending, invitation);
      },
    },
    carried: () => [...carried],
  };
}

function unreferredBy(answer: Readonly<Response>): readonly (string | null)[] {
  return [answer.headers.get('cache-control'), answer.headers.get('referrer-policy')];
}

describe('an invitation link opened in a browser', () => {
  it('remembers a pending invitation for that browser in a cookie of its own for an hour, and sends the browser on, neither kept nor passed on', async () => {
    const browser = browserAt((await aServer()).at);

    const opened = await browser.at(`/invitations/${pendingInvitationSecret}`);

    const remembered = browser.setCookies.filter((cookie) => cookie.startsWith(`${invitationCookie}=`));
    const expiresAt = Date.parse(String(/expires=(?<at>[^;]+)/u.exec(remembered.join(''))?.groups?.['at']));
    expect([opened.status, locationOf(opened), ...unreferredBy(opened)]).toEqual([
      303,
      studioOpenedAt,
      'no-store',
      'no-referrer',
    ]);
    expect(remembered).toEqual([
      expect.stringMatching(
        /^__Host-Http-invitation=kQ2_x-9pendingInvitation; path=\/; expires=[^;]+; samesite=lax; secure; httponly$/iu,
      ),
    ]);
    expect(Math.abs(expiresAt - Date.parse(String(opened.headers.get('date'))) - 3_600_000)).toBeLessThanOrEqual(1000);
  });

  it('shows the page of a link that stopped working, neither kept nor passed on, and remembers nothing', async () => {
    const server = await aServer();
    const browser = browserAt(server.at);

    const ended = await browser.at('/invitations/a-link-revoked-used-or-expired');

    expect(unreferredBy(ended)).toEqual(['no-store', 'no-referrer']);
    expect([server.pagesShown, browser.cookies.has(invitationCookie)]).toEqual([[{ invitationEnded: true }], false]);
  });
});

describe('a cookie of an invitation a person types by hand', () => {
  it('is handed to the sign-in as it is, which decides what it accepts, and cleared', async () => {
    const typing = carriedTo();
    const browser = browserAt((await aServer({ signIn: typing.signIn })).at);
    browser.cookieSet(invitationCookie, 'an-id-from-a-listing');

    await signedInAs(browser, { clientId: await registered(browser) });

    expect([typing.carried(), browser.cookies.has(invitationCookie)]).toEqual([['an-id-from-a-listing'], false]);
  });
});

describe('an invitation a browser carries into a sign-in', () => {
  it('is handed to the sign-in as it finishes, once, and cleared whatever the outcome', async () => {
    const [admitting, refusing] = [carriedTo(), carriedTo(() => Promise.resolve({ refused: 'no_access' }))];
    const browser = browserAt((await aServer({ signIn: admitting.signIn })).at);
    const refused = browserAt((await aServer({ signIn: refusing.signIn })).at);
    const clientId = await registered(browser);

    await browser.at(`/invitations/${pendingInvitationSecret}`);
    await signedInAs(browser, { clientId });
    await signedInAs(browser, { clientId, prompt: 'select_account' });
    await refused.at(`/invitations/${pendingInvitationSecret}`);
    await backFromTheSignIn(refused, await signInBegun(refused, { clientId: await registered(refused) }));

    expect([admitting.carried(), refusing.carried()]).toEqual([
      [pendingInvitationSecret, undefined],
      [pendingInvitationSecret],
    ]);
    expect([browser.cookies.has(invitationCookie), refused.cookies.has(invitationCookie)]).toEqual([false, false]);
  });
});
