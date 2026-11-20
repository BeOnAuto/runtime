import { describe, expect, it } from 'vitest';

import {
  authorizationAskedBy,
  connectedAt,
  fieldsOf,
  locationOf,
  refreshed,
  serversClosedAfterAll,
} from '../testing/agents-signing-in.ts';
import { issuer, signingIn } from '../testing/authorization-server-over-http.ts';
import type { InteractionSignIn } from './interaction-pages.ts';
import { everyoneSignedOut, personSignedOut } from './signed-out.ts';

const aServer = serversClosedAfterAll();

describe('everyone signed out at once', () => {
  it('ends every sign-in and grant, so a token is no longer read, a refresh is refused and the person is asked to sign in again', async () => {
    const { server, browser, clientId, tokens } = await connectedAt(await aServer());

    await everyoneSignedOut(server.rows);
    const renewed = await refreshed(browser, clientId, tokens['refresh_token']);
    const askedAgain = await browser.at(authorizationAskedBy({ clientId }));

    expect([renewed.status, (await fieldsOf(renewed))['error']]).toEqual([400, 'invalid_grant']);
    expect(await server.server.accessTokenOf(String(tokens['access_token']))).toBeUndefined();
    expect(new URL(locationOf(askedAgain), issuer).pathname).toMatch(/^\/interaction\//u);
  });
});

interface SigningInAs {
  readonly signIn: InteractionSignIn;
  readonly as: (person: string) => void;
}

function signingInAs(first: string): SigningInAs {
  const signing = { person: first };
  return {
    signIn: {
      ...signingIn,
      finished: async (query, pending, invitation) => {
        const outcome = await signingIn.finished(query, pending, invitation);
        return 'admitted' in outcome ? { admitted: signing.person } : outcome;
      },
    },
    as: (person) => {
      signing.person = person;
    },
  };
}

describe('one person signed out', () => {
  it('ends that person’s sign-ins and grants, so their tokens are no longer read or renewed and they are asked to sign in again, and leaves everyone else’s', async () => {
    const signing = signingInAs('ada');
    const server = await aServer({ signIn: signing.signIn });
    const ada = await connectedAt(server);
    signing.as('grace');
    const grace = await connectedAt(server);

    await personSignedOut(server.rows, 'ada');
    await personSignedOut(server.rows, 'a person never signed in');
    const renewed = await Promise.all(
      [ada, grace].map(({ browser, clientId, tokens }) => refreshed(browser, clientId, tokens['refresh_token'])),
    );
    const askedAgain = await Promise.all(
      [ada, grace].map(({ browser, clientId }) => browser.at(authorizationAskedBy({ clientId }))),
    );

    expect(renewed.map(({ status }) => status)).toEqual([400, 200]);
    expect(await server.server.accessTokenOf(String(ada.tokens['access_token']))).toBeUndefined();
    expect(await server.server.accessTokenOf(String(grace.tokens['access_token']))).toMatchObject({
      accountId: 'grace',
    });
    expect(askedAgain.map((answer) => new URL(locationOf(answer), issuer).pathname)).toEqual([
      expect.stringMatching(/^\/interaction\//u),
      expect.not.stringMatching(/^\/interaction\//u),
    ]);
  });
});
