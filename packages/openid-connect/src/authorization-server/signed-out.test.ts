import { describe, expect, it } from 'vitest';

import {
  authorizationAskedBy,
  connectedAt,
  fieldsOf,
  locationOf,
  refreshed,
  serversClosedAfterAll,
} from '../testing/agents-signing-in.ts';
import { issuer } from '../testing/authorization-server-over-http.ts';
import { everyoneSignedOut } from './signed-out.ts';

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
