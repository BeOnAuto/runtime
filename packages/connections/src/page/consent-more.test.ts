import type { Outcome, Succeeded } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { servedThroughAuto } from '@on.auto/tool-servers/served-fakes';
import { autoClientsOf, consentedAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnectedFor, reconnectingFor, type Added } from '../testing/additions.ts';
import {
  connectedThrough,
  consentFake,
  consentHarnessAt,
  filesAt,
  finishing,
  scopeAskedAt,
  sharing,
  sharingWay,
  startedAt,
  starting,
} from '../testing/consents.ts';
import { ada, operationNamed, type Harness, loopbackPolicy } from '../testing/harness.ts';
import { preparedOf, sourceOver } from '../testing/served-connections.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const bothSaid = [
  { name: 'files.read', says: 'Read the files of the account.' },
  { name: 'files.share', says: sharing.says['files.share'] },
];

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake({ dynamicRegistration: true });
  closing.push(fake.close);
  return fake;
}

async function sharingHarness(): Promise<Harness> {
  return consentHarnessAt(await served(), { way: sharingWay });
}

function reading(h: Harness, { id, token }: Added, at?: string): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'read_link'), ada, { id, token }, at);
}

describe('a consent that asks more of a connection still pending', () => {
  it('asks the scopes its credential asks with the group’s, with the parameters of the way, and connects it granted both', async () => {
    const h = await sharingHarness();
    const { id } = await added(h, { provider: 'files' });

    const link = await reconnectedFor(h, id, 'share');
    const { url } = await startedAt(h, link);
    const started = (await h.facts()).at(-1);
    const finished = await finishing(h, link, await consentedAt(url));

    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({
      scope: 'files.read files.share',
      access_type: 'offline',
    });
    expect(started).toMatchObject({
      type: 'connection_consent_started',
      data: { scope: 'files.read files.share', says: sharing.says },
    });
    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', asked_scopes: bothSaid, granted_scope: 'files.read files.share' },
    });
    expect(finished).toMatchObject({ output: { granted_scopes: bothSaid } });
  });

  it('is read on the page with the group it asks, and the scopes asked with the group’s beside them', async () => {
    const h = await sharingHarness();
    const { id } = await added(h, { provider: 'files' });

    const read = await reading(h, await reconnectedFor(h, id, 'share'));

    expect(read).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'pending',
        asked_scopes: bothSaid,
        link: { more: { name: 'share', for: sharing.for } },
        client_source: 'registered',
      },
    });
  });
});

describe('a consent that asks more of a connection connected or broken', () => {
  it('asks what the connection asked and was granted with the group’s, and leaves it connected with both', async () => {
    const h = await sharingHarness();
    const first = await added(h, { provider: 'files' });
    await connectedThrough(h, first);

    const link = await reconnectedFor(h, first.id, 'share', fiveMinutesLater);
    const { url } = await startedAt(h, link, fiveMinutesLater);
    const finished = await finishing(h, link, await consentedAt(url), fiveMinutesLater);

    expect(new URL(url).searchParams.get('scope')).toBe('files.read files.share');
    expect(finished).toMatchObject({
      output: { status: 'connected', connected_at: fiveMinutesLater, granted_scope: 'files.read files.share' },
    });
  });

  it('gives a broken connection a link, which asks what the connection was granted with the group’s', async () => {
    const h = await sharingHarness();
    const link = await added(h, { provider: 'files' });
    await connectedThrough(h, link);
    await Effect.runPromise((await preparedOf(sourceOver(h, { policy: loopbackPolicy }), link.id)).refused);

    const answered = await reconnectingFor(h, link.id, 'share', fiveMinutesLater);
    const scope = await scopeAskedAt(h, await reconnectedFor(h, link.id, 'share', fiveMinutesLater), fiveMinutesLater);

    expect(answered).toMatchObject({ status: 'succeeded', output: { status: 'broken', connect: {} } });
    expect(scope).toBe('files.read files.share');
  });
});

describe('a consent that asks more through Auto’s consent service', () => {
  it('asks the service for the scopes the connection was granted with the group’s, with the parameters of the way', async () => {
    const serving = await servedThroughAuto();
    closing.push(serving.close);
    const h = consentHarnessAt(serving.fake, {
      way: sharingWay,
      consenting: { autoClients: autoClientsOf(serving.service) },
      pages: {
        studio: { origin: 'https://studio.example.com', served: false },
        runtime: () => 'http://localhost:5555',
      },
    });
    const pending = await added(h, { provider: 'files' });

    const started = await starting(h, await reconnectedFor(h, pending.id, 'share'));

    expect(started).toMatchObject({ status: 'succeeded', output: { client_source: 'auto' } });
    expect(serving.service.calls().at(-1)?.body).toMatchObject({
      scope: 'files.read files.share',
      parameters: { access_type: 'offline' },
    });
  });
});

describe('a link given for a group its provider no longer names', () => {
  it('is refused on the page and at its start, in words that say to reconnect the connection, whether the way or the provider is gone', async () => {
    const fake = await served();
    const h = consentHarnessAt(fake, { way: sharingWay });
    const { id } = await added(h, { provider: 'files' });
    const { token } = await reconnectedFor(h, id, 'share');
    const changed = [providerListOf(filesAt(fake)), providerListOf()].map((providers) =>
      h.operationsWith({ providers }),
    );
    const gone = {
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The provider of the connection files no longer names “share” among what its connections may be granted later, so this link cannot ask it; reconnect the connection for a new link',
    };

    const answers = await Promise.all(
      changed.flatMap((operations) =>
        ['read_link', 'start'].map((name) => h.call(operationNamed(operations, name), ada, { id, token })),
      ),
    );

    expect(answers).toMatchObject([gone, gone, gone, gone]);
  });
});
