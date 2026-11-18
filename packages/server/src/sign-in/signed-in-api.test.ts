import { createApiKey } from '@on.auto/identity';
import { defaultOrg, personIdOf } from '@on.auto/openid-connect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { goalsText } from '../testing/settings/goals-kept.ts';
import { providerOverHttps } from './issuer-over-https.ts';

const subject = 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4';

interface Asking {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

type FakeProvider = Awaited<ReturnType<typeof providerOverHttps>>;

interface SigningIn {
  readonly provider: FakeProvider;
  readonly address: string;
  readonly at: (path: string, init?: Asking) => Promise<Response>;
}

async function signingIn(beside: Readonly<Record<string, string>>): Promise<SigningIn> {
  const provider = await providerOverHttps('/tenant/v2.0');
  const port = await aPortNothingListensOn();
  const ledger = temporaryLedger();
  const server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_URL: `http://localhost:${port}`,
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: provider.clientId,
      OIDC_CLIENT_SECRET: provider.clientSecret,
      ...beside,
      LEDGER_FILE: ledger.fileName,
    },
    compositionRoot,
  );
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  const at = (path: string, init: Asking = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', ...init });
  return { provider, address: `http://localhost:${port}`, at };
}

function cookieValueOf(answer: Readonly<Response>, name: string): string {
  const named = answer.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return String(named?.split(';')[0]);
}

async function sessionAfterSigningIn({ provider, at }: SigningIn): Promise<string> {
  const started = await at('/auth/oidc');
  const callback = await at(
    `/auth/oidc/callback?${provider.signedIn(String(started.headers.get('location')), subject)}`,
    {
      headers: { cookie: cookieValueOf(started, '__Host-sign-in') },
    },
  );
  return cookieValueOf(callback, '__Host-session');
}

const playbookAlpha = JSON.stringify({ playbook: 'alpha', name: 'Alpha', goals: goalsText });

const asJson = { 'content-type': 'application/json' };

describe('the API of a runtime whose people sign in through the identity provider OIDC_ISSUER names', () => {
  it('serves a person signed in there as their id in the organization default, only with the anti-forgery header', async () => {
    const key = createApiKey({ id: 'build-bot', org: defaultOrg, permissions: ['org:read'], playbooks: '*' });
    const signingInHere = await signingIn({ API_KEYS: JSON.stringify([key.entry]) });
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
