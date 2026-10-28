import { providerListOf, providerOf } from '@on.auto/providers/testing';
import { consentedAt, registeredAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { clientRegistrationsStream } from '../registrations/client-registrations.ts';
import { added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt, filesApiAt, finishing, startedAt } from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  const fake = await consentFake(changes);
  closing.push(fake.close);
  return fake;
}

const dynamicWay = { clients: ['dynamic'] };

describe('the client a connection is connected with', () => {
  it('is registered dynamically once at its issuer, recorded in a stream of the runtime, and used again by a later connection', async () => {
    const fake = await served({ dynamicRegistration: true });
    const h = consentHarnessAt(fake, { way: dynamicWay });
    const first = await added(h, { provider: 'files' });
    const second = await added(h, { provider: 'files', name: 'files-again' });

    const connected = await finishing(h, first, await consentedOf(h, first));
    await startedAt(h, second);

    expect(connected).toMatchObject({
      output: { status: 'connected', credential: { client_id: 'registered-1', client_source: 'dynamic' } },
    });
    expect(fake.heard().filter(({ path }) => path === '/register')).toHaveLength(1);
    expect(h.ledger.streamNames()).toContain(clientRegistrationsStream);
  });

  it('is gone where the registration it was made with is no longer kept, and the finish says so', async () => {
    const fake = await served({ dynamicRegistration: true });
    const h = consentHarnessAt(fake, { way: dynamicWay });
    const link = await added(h, { provider: 'files' });
    const consented = await consentedOf(h, link);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    expect(await finishing(h, link, consented)).toMatchObject({
      reason: 'conflict',
      detail:
        'The client the connection files was made with is no longer registered, so the person starts the consent again',
    });
  });
});

describe('a connection of an HTTP API whose way gives its endpoints', () => {
  it('is connected through a server that publishes no metadata, with no scope where none was asked or granted', async () => {
    const fake = await served({ publishesMetadata: false });
    const h = consentHarnessAt(fake, { providers: providerListOf(filesApiAt(fake)) });
    const link = await added(h, { provider: 'files-api' });

    const connected = await finishing(h, link, await consentedOf(h, link));

    expect(connected).toMatchObject({ output: { status: 'connected', type: 'openapi', granted_scope: null } });
    expect(connected).not.toHaveProperty('output.credential.scope');
  });
});

describe('a connection connected by consent', () => {
  it('forgets the verifier of an open start when it is removed while pending', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake);
    const link = await added(h, { provider: 'files' });
    await startedAt(h, link);

    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });

    expect(h.secrets.values().size).toBe(0);
  });
});

function tenantAt(fake: FakeMcpServer, tenant: string) {
  return providerOf({
    name: `adverts-${tenant}`,
    title: 'Adverts',
    description: 'Read the campaigns of the accounts a person reaches.',
    website: 'https://developer.adverts.example.com',
    type: 'mcp',
    url: `${fake.url}?toolSetNames=OpenBeta`,
    credentials: [
      {
        kind: 'authorization',
        issuer: `${fake.origin}/${tenant}/v2.0`,
        authorization_endpoint: `${fake.origin}/authorize`,
        token_endpoint: `${fake.origin}/token`,
        scope: 'adverts.manage offline_access',
        says: {
          'adverts.manage': 'Manage the campaigns of the accounts reached.',
          offline_access: 'Keep access to Adverts when nobody is signed in.',
        },
      },
    ],
  });
}

async function connectedAndRemoved(h: Harness, provider: string) {
  const link = await added(h, { provider });
  const { url } = await startedAt(h, link);
  const { code, state } = await consentedAt(url);
  const connected = await h.call(operationNamed(h.operations, 'finish'), ada, {
    id: link.id,
    token: link.token,
    code,
    state,
  });
  await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });
  const asked = new URL(url).searchParams;
  return [asked.get('scope'), asked.has('resource'), connected];
}

describe('a connection of an MCP server whose way gives its endpoints at a tenant of a multi-tenant issuer', () => {
  it('connects at an address with a query and no metadata, through the client registered at its issuer’s template, and is removed without a revocation', async () => {
    const fake = await served({ publishesMetadata: false });
    const h = consentHarnessAt(fake, {
      providers: providerListOf(tenantAt(fake, 'common'), tenantAt(fake, 'organizations')),
      consenting: { registeredClients: [registeredAt(`${fake.origin}/{tenant}/v2.0`)] },
    });
    const common = await connectedAndRemoved(h, 'adverts-common');
    const organizations = await connectedAndRemoved(h, 'adverts-organizations');

    expect([common, organizations]).toMatchObject(
      Array.from({ length: 2 }, () => [
        'adverts.manage offline_access',
        false,
        { output: { status: 'connected', credential: { client_id: 'auto-runtime', client_source: 'registered' } } },
      ]),
    );
    expect(fake.heard().map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        '/.well-known/oauth-protected-resource/mcp?toolSetNames=OpenBeta',
        '/.well-known/oauth-protected-resource',
      ]),
    );
    expect(fake.heard().map(({ path }) => path)).not.toContain('/revoke');
  });
});
