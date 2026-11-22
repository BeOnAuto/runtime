import { keyMadeAt, providerListOf, providerOf } from '@on.auto/providers/testing';
import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import type { ClientRegistration } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { added, lastFact, notes, type Added } from '../testing/additions.ts';
import { byHandAt, harnessByHand, readingTheLink } from '../testing/by-hand.ts';
import {
  consentFake,
  consentHarnessAt,
  filesAt,
  givingTheClient,
  orgsOAuthClientFake,
  startedAt,
  underTheOrgsOAuthClient,
} from '../testing/consents.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const anyWords: unknown = expect.any(String);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function served(changes: Partial<ClientRegistration> = {}): FakeMcpServer {
  const fake = consentFake({ dynamicRegistration: true, requiredScopes: ['files.read'], ...changes });
  closing.push(fake.close);
  return fake;
}

const aKey = {
  kind: 'secret',
  in: 'header',
  name: 'Authorization',
  scheme: 'Bearer',
  ...keyMadeAt('app.desk.example.com'),
};

const signingIn = {
  kind: 'authorization',
  issuer: 'https://{region}.auth.desk.example.com',
  scope: 'tickets.read',
  says: { 'tickets.read': 'Read the tickets of the desk.' },
  clients: ['dynamic'],
};

const region = { description: 'The region of your desk', pattern: '^.{1,40}$', example: 'eu' };

const inItsRegion: Readonly<Record<string, unknown>> = { region };

function deskWith(credentials: readonly unknown[], placeholders = inItsRegion) {
  return providerListOf(
    providerOf({
      name: 'desk',
      title: 'Desk',
      description: 'Read the tickets of a help desk.',
      website: 'https://developer.desk.example.com',
      type: 'mcp',
      url: 'https://mcp.desk.example.com/mcp',
      headers: Object.fromEntries(Object.keys(placeholders).map((name) => [`X-Desk-${name}`, `{${name}}`])),
      placeholders,
      credentials,
    }),
  );
}

const desk = deskWith([aKey, { ...aKey, permissions: 'application' }, signingIn, { kind: 'none' }]);

function choosing(h: Harness, { id, token }: Added, choice: Readonly<Record<string, unknown>>) {
  return h.call(operationNamed(h.operations, 'choose_way'), ada, { id, token, ...choice });
}

function addedToTheDesk(h: Harness, name = 'desk'): Promise<Added> {
  return added(h, { provider: 'desk', name, placeholders: { region: 'eu' } });
}

describe('choosing how a connection made from a provider connects', () => {
  it('records the way and account type chosen, keeping its id, name and link, which then reads the way chosen', async () => {
    const h = harness({ providers: desk });
    const link = await addedToTheDesk(h);

    const outcome = await choosing(h, link, { credential: { kind: 'authorization' }, account_type: 'service' });

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: {
        id: link.id,
        name: 'desk',
        status: 'pending',
        credential: { kind: 'authorization', issuer: 'https://eu.auth.desk.example.com', scope: 'tickets.read' },
        permissions: 'delegated',
        account_type: 'service',
        asked_scopes: [{ name: 'tickets.read', says: 'Read the tickets of the desk.' }],
      },
    });
    expect(await lastFact(h)).toMatchObject({ connection: link.id, account_type: 'service' });
    expect(await readingTheLink(h, link)).toMatchObject({ output: { credential: { kind: 'authorization' } } });
  });

  it('tells two ways of one kind apart by their permissions, and approves the connection through the way chosen', async () => {
    const h = harness({ providers: desk });
    const link = await addedToTheDesk(h);
    const other = await addedToTheDesk(h, 'desk-2');

    const asTheApp = await choosing(h, link, { credential: { kind: 'secret', permissions: 'application' } });
    await choosing(h, other, { credential: { kind: 'none' } });

    expect(asTheApp).toMatchObject({ output: { permissions: 'application', account_type: null } });
    expect(
      await h.call(operationNamed(h.operations, 'approve'), ada, { id: other.id, token: other.token }),
    ).toMatchObject({ output: { status: 'connected', credential: { kind: 'none' } } });
  });
});

describe('a way of its provider that a connection cannot take', () => {
  it('is refused where it asks now for a value its addition never gave, as invalid input, recording nothing', async () => {
    const h = harness({ providers: desk });
    const link = await addedToTheDesk(h);
    const before = await h.facts();
    const tenant = { ...region, description: 'The tenant of your desk' };
    const asking = deskWith([aKey, { ...signingIn, issuer: 'https://{tenant}.auth.desk.example.com' }], {
      region,
      tenant,
    });

    expect(
      await choosing(harness({ providers: asking, ledger: h.ledger }), link, { credential: { kind: 'authorization' } }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/placeholders/tenant' }] });
    expect(await h.facts()).toEqual(before);
  });

  it('is refused where this runtime does not allow it, as forbidden', async () => {
    const h = harness({ providers: desk, policy: connectionPolicyOf({ credential_kinds: ['secret'] }) });
    const link = await addedToTheDesk(h);

    expect(await choosing(h, link, { credential: { kind: 'none' } })).toMatchObject({
      status: 'rejected',
      reason: 'forbidden',
    });
  });

  it('is refused where this runtime no longer lists its provider, as invalid input, recording nothing', async () => {
    const h = harness({ providers: desk });
    const link = await addedToTheDesk(h);
    const before = await h.facts();
    const gone = h.operationsWith({ providers: providerListOf() });

    expect(
      await h.call(operationNamed(gone, 'choose_way'), ada, {
        id: link.id,
        token: link.token,
        credential: { kind: 'none' },
      }),
    ).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/credential' }] });
    expect(await h.facts()).toEqual(before);
  });
});

async function underItsOwnClientWithAKey(): Promise<{ readonly h: Harness; readonly link: Added }> {
  const fake = orgsOAuthClientFake();
  closing.push(fake.close);
  const { entry } = filesAt(fake);
  const withAKey = providerOf({ ...entry, credentials: [...entry.credentials, { ...aKey, name: 'X-Files-Key' }] });
  const h = consentHarnessAt(fake, { providers: providerListOf(withAKey) });
  const link = await added(h, underTheOrgsOAuthClient);
  await givingTheClient(h, link);
  await startedAt(h, link);
  return { h, link };
}

describe('choosing a way of a connection under the organization’s own OAuth client', () => {
  it('forgets the client secret given and the verifier of the sign-in started, for another way', async () => {
    const { h, link } = await underItsOwnClientWithAKey();
    const kept = [...h.secrets.values().keys()];

    await choosing(h, link, { credential: { kind: 'secret' } });

    expect(kept).toHaveLength(2);
    expect([...h.secrets.values().keys()]).toEqual([]);
  });

  it('keeps them, and the sign-in started, for the way it has', async () => {
    const { h, link } = await underItsOwnClientWithAKey();
    const kept = [...h.secrets.values().keys()];

    await choosing(h, link, { credential: { kind: 'authorization' }, account_type: 'service' });

    expect([...h.secrets.values().keys()]).toEqual(kept);
    expect(await lastFact(h)).toEqual({ connection: link.id, account_type: 'service' });
  });
});

const signingInByHand = {
  kind: 'authorization',
  permissions: 'delegated',
  account_types: ['service', 'personal'],
  offered: true,
};

describe('choosing how a server given by hand connects', () => {
  it('offers on its link each way its metadata names, and connects it as the app or signs in again', async () => {
    const fake = served();
    const h = harnessByHand();
    const link = await added(h, byHandAt(fake));

    const read = await readingTheLink(h, link);
    const asTheApp = await choosing(h, link, { credential: { kind: 'client_credentials' } });
    const again = await choosing(h, link, { credential: { kind: 'authorization' }, account_type: 'service' });

    expect(read).toMatchObject({
      output: {
        ways: [signingInByHand, { kind: 'client_credentials', permissions: 'application', offered: true }],
      },
    });
    expect(asTheApp).toMatchObject({
      output: {
        credential: { kind: 'client_credentials', issuer: fake.origin, scope: 'files.read' },
        permissions: 'application',
      },
    });
    expect(again).toMatchObject({
      output: { credential: { kind: 'authorization', clients: ['dynamic'] }, account_type: 'service' },
    });
  });
});

describe('a way a server given by hand does not name', () => {
  it('is refused as invalid input, recording nothing', async () => {
    const h = harness();
    const link = await added(h, notes);
    const before = await h.facts();

    expect(await choosing(h, link, { credential: { kind: 'secret' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/credential' }],
    });
    expect(await h.facts()).toEqual(before);
  });
});

describe('the ways the link of a server given by hand offers', () => {
  it('are the one way of a server whose metadata lists no client credentials, and none for a provider', async () => {
    const fake = served({ grantTypes: ['authorization_code'] });
    const h = harnessByHand({
      providers: desk,
      policy: connectionPolicyOf({ allowed_hosts: ['127.0.0.1', '*.in-process.test', '*.desk.example.com'] }),
    });
    const byHand = await added(h, byHandAt(fake));
    const fromTheDesk = await addedToTheDesk(h);

    expect((await h.facts())[0]?.data).not.toHaveProperty('ways');
    expect(await readingTheLink(h, byHand)).toMatchObject({ output: { ways: [signingInByHand] } });
    expect(await readingTheLink(h, fromTheDesk)).not.toHaveProperty('output.ways');
  });

  it('are the one way of a server that takes no credential, which acts as no account', async () => {
    const h = harness();
    const link = await added(h, notes);

    expect(await readingTheLink(h, link)).toMatchObject({ output: { ways: [{ kind: 'none', offered: true }] } });
    expect(await readingTheLink(h, link)).not.toHaveProperty('output.ways.0.permissions');
  });

  it('say why a way this runtime does not allow is not offered, which is then refused', async () => {
    const fake = served();
    const h = harnessByHand({
      policy: connectionPolicyOf({
        allowed_hosts: ['127.0.0.1', '*.in-process.test'],
        credential_kinds: ['authorization'],
      }),
    });
    const link = await added(h, byHandAt(fake));

    expect(await readingTheLink(h, link)).toMatchObject({
      output: { ways: [{ offered: true }, { offered: false, because: anyWords }] },
    });
    expect(await choosing(h, link, { credential: { kind: 'client_credentials' } })).toMatchObject({
      reason: 'forbidden',
    });
  });
});
