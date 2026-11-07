import { providerListOf } from '@on.auto/providers/testing';
import { consentedAt, registeredAt, type ClientRegistration, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnected, reconnectedFor, type Added } from '../testing/additions.ts';
import {
  connectedThrough,
  consentFake,
  consentHarnessAt,
  filesAt,
  filesWay,
  finishing,
  scopeAskedAt,
  sharing,
  sharingWay,
} from '../testing/consents.ts';
import { harnessConsentOf } from '../testing/harness-services.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const later = '2026-10-15T14:05:00.000Z';

const stillLater = '2026-10-15T14:10:00.000Z';

type Way = Readonly<Record<string, unknown>>;

const writingWay = { ...filesWay, scope: 'files.read files.write' };

async function consentingWith(way: Way, changes: Partial<ClientRegistration> = {}) {
  const fake = await consentFake({ dynamicRegistration: true, ...changes });
  closing.push(fake.close);
  return { fake, h: consentHarnessAt(fake, { way }) };
}

function sharingAt(changes: Partial<ClientRegistration> = {}) {
  return consentingWith(sharingWay, changes);
}

function withTheWay(fake: FakeMcpServer, h: Harness, way: Way) {
  return h.operationsWith({ providers: providerListOf(filesAt(fake, way)) });
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

const StartedFactSchema = Schema.Struct({
  type: Schema.Literal('connection_consent_started'),
  data: Schema.Struct({ scope: Schema.String, says: Schema.Record(Schema.String, Schema.String) }),
});

async function authorizeUrlThrough(
  h: Harness,
  operations: Harness['operations'],
  { id, token }: Added,
  at: string,
): Promise<string> {
  const started = await h.call(operationNamed(operations, 'start'), ada, { id, token }, at);
  return Schema.decodeUnknownSync(AuthorizeSchema)(started).output.authorize.url;
}

async function scopeAskedThrough(
  h: Harness,
  operations: Harness['operations'],
  link: Added,
  at: string,
): Promise<string | null> {
  return new URL(await authorizeUrlThrough(h, operations, link, at)).searchParams.get('scope');
}

function readingAlone(fake: FakeMcpServer, h: Harness) {
  const covering = { registeredClients: [registeredAt(fake.origin, { scopes: ['files.read'] })] };
  return h.operationsWith({ consent: harnessConsentOf(h.ledger.service, h.secrets, covering) });
}

describe('a plain link of a connection granted a group of more', () => {
  it('asks the scope its provider’s way asks with the group’s, so the person keeps what they allowed, and offers it no more', async () => {
    const { h } = await sharingAt();
    const id = await grantedTheGroup(h);

    const listed = await h.call(operationNamed(h.operations, 'list_connections'), ada, {}, stillLater);
    const scope = await scopeAskedAt(h, await reconnected(h, id, stillLater), stillLater);

    expect(listed).toMatchObject({ output: { connections: [{ id, more: [] }] } });
    expect(scope).toBe('files.read files.share');
  });

  it('asks the scope its provider’s way asks alone where no client set up here covers the group’s too', async () => {
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

describe('a scope the provider dropped from its way after the connection was added', () => {
  it('is not asked by a link, nor shown on its page, and the connection records what the server granted', async () => {
    const { fake, h } = await consentingWith(writingWay);
    const { id } = await connected(h);
    const narrowed = withTheWay(fake, h, filesWay);

    const link = await reconnected(h, id, later);
    const read = await h.call(operationNamed(narrowed, 'read_link'), ada, { id, token: link.token }, later);
    const url = await authorizeUrlThrough(h, narrowed, link, later);
    await finishing(h, link, await consentedAt(url), later);
    const recorded = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id }, later);

    expect(new URL(url).searchParams.get('scope')).toBe('files.read');
    expect(read).toMatchObject({ output: { asked_scopes: [{ name: 'files.read' }] } });
    expect(recorded).toMatchObject({
      output: { status: 'connected', granted_scope: 'files.read', granted_scopes: [{ name: 'files.read' }] },
    });
  });
});

describe('a group of more the connection holds, after its provider changed its way', () => {
  it('is asked by a plain link while the way still offers it, beside the scopes the way asks now', async () => {
    const { fake, h } = await consentingWith({ ...writingWay, more: [sharing] });
    const { id } = await connected(h);
    await connectedThrough(h, await reconnectedFor(h, id, 'share', later), later);
    const narrowed = withTheWay(fake, h, sharingWay);

    const scope = await scopeAskedThrough(h, narrowed, await reconnected(h, id, stillLater), stillLater);

    expect(scope).toBe('files.read files.share');
  });

  it('is not asked by a plain link once the way no longer offers it', async () => {
    const { fake, h } = await sharingAt();
    const id = await grantedTheGroup(h);
    const withoutTheGroup = withTheWay(fake, h, filesWay);

    const scope = await scopeAskedThrough(h, withoutTheGroup, await reconnected(h, id, stillLater), stillLater);

    expect(scope).toBe('files.read');
  });

  it('is asked by its link beside what the connection holds that the way still asks, and nothing the way dropped', async () => {
    const { fake, h } = await consentingWith({ ...writingWay, more: [sharing] });
    const { id } = await connected(h);
    const narrowed = withTheWay(fake, h, sharingWay);

    const scope = await scopeAskedThrough(h, narrowed, await reconnectedFor(h, id, 'share', later), later);

    expect(scope).toBe('files.read files.share');
  });
});

describe('a scope the provider added to its way after the connection was added', () => {
  it('is asked by a link, and shown on its page with the words the way says of it', async () => {
    const { fake, h } = await consentingWith(filesWay);
    const { id } = await connected(h);
    const widened = withTheWay(fake, h, writingWay);

    const link = await reconnected(h, id, later);
    const read = await h.call(operationNamed(widened, 'read_link'), ada, { id, token: link.token }, later);
    const scope = await scopeAskedThrough(h, widened, link, later);

    expect(scope).toBe('files.read files.write');
    expect(read).toMatchObject({
      output: {
        asked_scopes: [
          { name: 'files.read', says: 'Read the files of the account.' },
          { name: 'files.write', says: 'Create and change the files of the account.' },
        ],
      },
    });
  });
});

describe('a link of a connection whose provider asks what it asked when the connection was added', () => {
  it('asks exactly what it asked before, and records the start as before', async () => {
    const { h } = await consentingWith(filesWay);
    const { id } = await connected(h);

    const scope = await scopeAskedAt(h, await reconnected(h, id, later), later);
    const started = Schema.decodeUnknownSync(StartedFactSchema)((await h.facts()).at(-1));

    expect(scope).toBe('files.read');
    expect(started.data).toEqual({ scope: 'files.read', says: {} });
  });
});
