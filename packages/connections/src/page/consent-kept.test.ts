import { registeredAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnected, reconnectedFor, type Added } from '../testing/additions.ts';
import { connectedThrough, consentFake, consentHarnessAt, scopeAskedAt, sharingWay } from '../testing/consents.ts';
import { harnessConsentOf } from '../testing/harness-services.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const later = '2026-10-15T14:05:00.000Z';

const stillLater = '2026-10-15T14:10:00.000Z';

async function sharingAt(changes: Partial<ClientRegistration> = {}) {
  const fake = await consentFake({ dynamicRegistration: true, ...changes });
  closing.push(fake.close);
  return { fake, h: consentHarnessAt(fake, { way: sharingWay }) };
}

async function connected(h: Harness): Promise<Added> {
  const link = await added(h, { provider: 'files' });
  await connectedThrough(h, link);
  return link;
}

async function grantedTheGroup(h: Harness): Promise<string> {
  const { id } = await connected(h);
  await connectedThrough(h, await reconnectedFor(h, id, 'share', later), later);
  return id;
}

const AuthorizeSchema = Schema.Struct({ output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String }) }) });

function readingAlone(fake: FakeMcpServer, h: Harness) {
  const covering = { registeredClients: [registeredAt(fake.origin, { scopes: ['files.read'] })] };
  return h.operationsWith({ consent: harnessConsentOf(h.ledger.service, h.secrets, covering) });
}

describe('a plain link of a connection granted a group of more', () => {
  it('asks the scope of its credential with the group’s, so the person keeps what they allowed, and offers it no more', async () => {
    const { h } = await sharingAt();
    const id = await grantedTheGroup(h);

    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada, {}, stillLater);
    const scope = await scopeAskedAt(h, await reconnected(h, id, stillLater), stillLater);

    expect(listed).toMatchObject({ output: { connections: [{ id, more: [] }] } });
    expect(scope).toBe('files.read files.share');
  });

  it('asks the scope of its credential alone where no client set up here covers the group’s too', async () => {
    const { fake, h } = await sharingAt();
    const id = await grantedTheGroup(h);
    const narrower = readingAlone(fake, h);

    const { token } = await reconnected(h, id, stillLater);
    const started = await h.call(operationNamed(narrower, 'start'), ada, { id, token }, stillLater);
    const read = await h.call(operationNamed(narrower, 'read_link'), ada, { id, token }, stillLater);

    expect(
      new URL(Schema.decodeUnknownSync(AuthorizeSchema)(started).output.authorize.url).searchParams.get('scope'),
    ).toBe('files.read');
    expect(read).toMatchObject({ output: { client_source: 'registered' } });
  });
});

describe('a group of more the person started and abandoned', () => {
  it('is not asked again by a plain link, and is still offered', async () => {
    const { h } = await sharingAt();
    const { id } = await connected(h);
    await scopeAskedAt(h, await reconnectedFor(h, id, 'share', later), later);

    const scope = await scopeAskedAt(h, await reconnected(h, id, stillLater), stillLater);
    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada, {}, stillLater);

    expect(scope).toBe('files.read');
    expect(listed).toMatchObject({ output: { connections: [{ id, more: [{ name: 'share' }] }] } });
  });
});

describe('a connection whose authorization server granted a scope it did not ask', () => {
  it('asks again only what it asked and was granted, by a link for more and by a plain link', async () => {
    const { h } = await sharingAt({ grantedScope: 'files.read calendar.read' });
    const { id } = await connected(h);

    const forMore = await scopeAskedAt(h, await reconnectedFor(h, id, 'share', later), later);
    const plain = await scopeAskedAt(h, await reconnected(h, id, stillLater), stillLater);

    expect([forMore, plain]).toEqual(['files.read files.share', 'files.read']);
  });
});

describe('a connection whose authorization server lists offline_access', () => {
  it('records the scope it asks without the offline_access the runtime adds to every request once', async () => {
    const { h } = await sharingAt({ scopesSupported: ['offline_access'] });
    const { id } = await connected(h);

    const forMore = await scopeAskedAt(h, await reconnectedFor(h, id, 'share', later), later);
    const started = (await h.facts()).at(-1);
    const plain = await scopeAskedAt(h, await reconnected(h, id, stillLater), stillLater);

    expect([forMore, plain]).toEqual(['files.read files.share offline_access', 'files.read offline_access']);
    expect(started).toMatchObject({ type: 'connection_consent_started', data: { scope: 'files.read files.share' } });
  });
});
