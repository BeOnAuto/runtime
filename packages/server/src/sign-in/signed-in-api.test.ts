import { createApiKey } from '@on.auto/identity';
import { defaultOrg, personIdOf } from '@on.auto/openid-connect';
import { describe, expect, it } from 'vitest';

import { goalsText } from '../testing/settings/goals-kept.ts';
import { callbackFor, cookieValueOf, signingIn, subject, type SigningIn } from './signing-in.ts';

async function sessionAfterSigningIn(signingInHere: SigningIn): Promise<string> {
  return cookieValueOf(await callbackFor(signingInHere, subject), '__Host-session');
}

const playbookAlpha = JSON.stringify({ playbook: 'alpha', name: 'Alpha', goals: goalsText });

const asJson = { 'content-type': 'application/json' };

describe('the API of a runtime whose people sign in through the identity provider OIDC_ISSUER names', () => {
  it('serves a person signed in there as their id in the organization default, only with the anti-forgery header', async () => {
    const key = createApiKey({ id: 'build-bot', org: defaultOrg, permissions: ['org:read'], playbooks: '*' });
    const signingInHere = await signingIn({ settings: { API_KEYS: JSON.stringify([key.entry]) } });
    const { provider, address, at } = signingInHere;
    const session = await sessionAfterSigningIn(signingInHere);
    const fromThePage = { cookie: session, 'x-csrf': '1' };
    const person = personIdOf({ issuer: provider.issuer, subject });

    const ridden = await at('/v1/orgs/default/playbooks', {
      method: 'POST',
      headers: { cookie: session, ...asJson },
      body: playbookAlpha,
    });
    const created = await at('/v1/orgs/default/playbooks', {
      method: 'POST',
      headers: { ...fromThePage, ...asJson },
      body: playbookAlpha,
    });
    const unknown = await at('/v1/orgs/default/playbooks', {
      headers: { cookie: '__Host-session=unknown', 'x-csrf': '1' },
    });
    const elsewhere = await at('/v1/orgs/acme/playbooks', { headers: fromThePage });
    const byKey = await at('/v1/orgs/default/playbooks', { headers: { authorization: `Bearer ${key.key}` } });
    const catalog = await at('/.well-known/api-catalog');

    expect([ridden.status, created.status, unknown.status, elsewhere.status, byKey.status]).toEqual([
      401, 201, 401, 403, 200,
    ]);
    expect(await created.json()).toMatchObject({ id: 'alpha', created_by: { id: `person:${person}`, name: person } });
    expect(await byKey.json()).toMatchObject({ playbooks: [{ id: 'alpha' }] });
    expect(catalog.headers.get('link')).toBe(`<${address}/.well-known/api-catalog>; rel="api-catalog"`);
  });
});
