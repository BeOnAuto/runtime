import { createApiKey } from '@on.auto/identity';
import { defaultOrg, personIdOf } from '@on.auto/openid-connect';
import { describe, expect, it } from 'vitest';

import { goalsText } from '../testing/settings/goals-kept.ts';
import {
  allowed,
  authorizationAskedBy,
  bearer,
  exchanged,
  fieldsOf,
  locationOf,
  publicUrl,
  registered,
  signedInAs,
  signingIn,
  studio,
  subject,
} from './signing-in.ts';

const playbookOf = (id: string) => JSON.stringify({ playbook: id, name: id, goals: goalsText });

const asJson = { 'content-type': 'application/json' };

const studioAsks = {
  clientId: studio.clientId,
  redirectUri: studio.redirectUri,
  scope: 'openid offline_access org:read org:write',
};

describe('the API of a runtime that is its own authorization server', () => {
  it("serves a person by a token it issued, an agent's as from the agent and Studio's as from Studio, and never by the sign-in cookie", async () => {
    const key = createApiKey({ id: 'build-bot', org: defaultOrg, permissions: ['org:read'], playbooks: '*' });
    const signing = await signingIn({ settings: { API_KEYS: JSON.stringify([key.entry]) } });
    const browser = signing.aBrowser();
    const clientId = await registered(browser);
    const consent = locationOf(await signedInAs(signing, browser, { clientId }, subject));
    const agentToken = await exchanged(browser, await allowed(browser, consent), { clientId });
    const studioCode = new URL(locationOf(await browser.at(authorizationAskedBy(studioAsks)))).searchParams.get('code');
    const studioToken = await exchanged(browser, String(studioCode), studioAsks);
    const person = personIdOf({ issuer: signing.provider.issuer, subject });

    const byTheAgent = await signing.at('/v1/orgs/default/playbooks', {
      method: 'POST',
      headers: { ...asJson, ...bearer(agentToken).headers },
      body: playbookOf('alpha'),
    });
    const byStudio = await signing.at('/v1/orgs/default/playbooks', {
      method: 'POST',
      headers: { ...asJson, ...bearer(studioToken).headers },
      body: playbookOf('beta'),
    });
    const byTheCookie = await browser.at('/v1/orgs/default/playbooks', { headers: { 'x-csrf': '1' } });
    const elsewhere = await signing.at('/v1/orgs/acme/playbooks', bearer(agentToken));
    const byKey = await signing.at('/v1/orgs/default/playbooks', bearer(key.key));

    expect([byTheAgent.status, byStudio.status, byTheCookie.status, elsewhere.status, byKey.status]).toEqual([
      201, 201, 401, 403, 200,
    ]);
    expect(await fieldsOf(byTheAgent)).toMatchObject({ created_by: { id: `person:${person}`, name: person } });
    expect(await fieldsOf(byStudio)).toMatchObject({ created_by: { id: `person:${person}`, name: person } });
  });

  it('names itself as the authorization server of its protected resource, and the metadata in each 401', async () => {
    const signing = await signingIn();

    const metadata = await fieldsOf(await signing.at('/.well-known/oauth-protected-resource'));
    const refused = await signing.at('/v1/orgs/default/playbooks', bearer('a-token-it-never-issued'));
    const catalog = await signing.at('/.well-known/api-catalog');

    expect(metadata).toMatchObject({ resource: publicUrl, authorization_servers: [publicUrl] });
    expect([refused.status, refused.headers.get('www-authenticate')]).toEqual([
      401,
      expect.stringContaining(`resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`),
    ]);
    expect(catalog.headers.get('link')).toBe(`<${publicUrl}/.well-known/api-catalog>; rel="api-catalog"`);
  });
});
