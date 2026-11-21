import type { Outcome, RegisteredPlainLanguage } from '@on.auto/operations';
import { mostOutcomeCharacters, withinCharacters } from '@on.auto/phrasing';
import { providerListOf } from '@on.auto/providers/testing';
import { consentedAt, registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, reconnectedFor, reconnectingFor } from '../testing/additions.ts';
import { consentFake, consentHarnessAt, filesWay, finishing, sharing, startedAt } from '../testing/consents.ts';
import { ada, operationNamed, type Harness, loopbackAndCrmPolicy } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const deleting = {
  name: 'delete',
  for: 'Delete files you no longer need.',
  scope: 'files.delete',
  says: { 'files.delete': 'Delete the files of the account.' },
};

const growingWay = { ...filesWay, more: [sharing, deleting] };

const offered = [
  { name: 'share', for: sharing.for },
  { name: 'delete', for: deleting.for },
];

function served(): FakeMcpServer {
  const fake = consentFake({ dynamicRegistration: true });
  closing.push(fake.close);
  return fake;
}

function listed(h: Harness, input: Readonly<Record<string, unknown>> = {}): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'list_connections'), ada, input);
}

async function connectedFor(h: Harness, more?: string): Promise<string> {
  const pending = await added(h, { provider: 'files' });
  const link = more === undefined ? pending : await reconnectedFor(h, pending.id, more);
  const { url } = await startedAt(h, link);
  await finishing(h, link, await consentedAt(url));
  return pending.id;
}

describe('the groups of more list_connections offers a connection', () => {
  it('are each group its way names while it holds none of them, and those it does not hold once it was granted some', async () => {
    const fake = served();
    const pending = consentHarnessAt(fake, { way: growingWay });
    const granted = consentHarnessAt(fake, { way: growingWay });
    await added(pending, { provider: 'files' });
    await connectedFor(granted, 'share');

    expect([await listed(pending), await listed(granted)]).toMatchObject([
      { output: { connections: [{ status: 'pending', more: offered }] } },
      { output: { connections: [{ status: 'connected', more: [{ name: 'delete', for: deleting.for }] }] } },
    ]);
  });

  it('are answered by get_connection too, and are none where the provider of the connection is gone', async () => {
    const h = consentHarnessAt(served(), { way: growingWay });
    const { id } = await added(h, { provider: 'files' });
    const gone = h.operationsWith({ providers: providerListOf() });

    expect([
      await h.call(operationNamed(h.operations, 'get_connection'), ada, { id }),
      await h.call(operationNamed(gone, 'get_connection'), ada, { id }),
    ]).toMatchObject([{ output: { id, more: offered } }, { output: { id, more: [] } }]);
  });
});

describe('the groups of more list_connections offers no connection', () => {
  it('are none for a connection given by hand, one of a way that names none and one removed, and leave out a group no client covers', async () => {
    const fake = served();
    const byHand = consentHarnessAt(fake, { way: growingWay, policy: loopbackAndCrmPolicy });
    const plain = consentHarnessAt(fake, { way: filesWay });
    const uncovered = consentHarnessAt(fake, {
      way: growingWay,
      consenting: { registeredClients: [registeredAt(fake.origin, { scopes: ['files.read', 'files.delete'] })] },
    });
    const removed = await added(byHand, { provider: 'files' });
    await byHand.call(operationNamed(byHand.operations, 'remove_connection'), ada, { id: removed.id });
    await added(byHand, crm);
    await added(plain, { provider: 'files' });
    await added(uncovered, { provider: 'files' });

    expect([
      await listed(byHand, { include_removed: true }),
      await listed(plain),
      await listed(uncovered),
    ]).toMatchObject([
      {
        output: {
          connections: [
            { name: 'crm', more: [] },
            { status: 'removed', more: [] },
          ],
        },
      },
      { output: { connections: [{ more: [] }] } },
      { output: { connections: [{ more: [{ name: 'delete' }] }] } },
    ]);
  });

  it('ask the consent client for no client source where no connection may be granted a group', async () => {
    const h = consentHarnessAt(served(), { way: filesWay });
    const { id } = await added(h, { provider: 'files' });
    const unasked = h.operationsWith({
      consent: { ...h.consent, hadSources: () => Effect.die(new Error('The sources were asked for')) },
    });

    expect([
      await h.call(operationNamed(unasked, 'list_connections'), ada),
      await h.call(operationNamed(unasked, 'get_connection'), ada, { id }),
    ]).toMatchObject([{ output: { connections: [{ id, more: [] }] } }, { output: { id, more: [] } }]);
  });
});

function reconnectingWords(h: Harness): RegisteredPlainLanguage {
  const { registration } = operationNamed(h.operations, 'reconnect_connection');
  if (!('plainLanguage' in registration) || registration.plainLanguage === undefined) {
    throw new Error('reconnect_connection has no words');
  }
  return registration.plainLanguage;
}

async function wordsOfReconnectingFor(h: Harness, id: string, more: string): Promise<string> {
  const outcome = await reconnectingFor(h, id, more);
  return reconnectingWords(h).outcome('output' in outcome ? outcome.output : undefined, { id, more });
}

describe('the words of reconnecting a connection for more', () => {
  it('keep, within the characters of an outcome, the advice to show the link by its name, whatever group it asks', async () => {
    const longest = {
      name: 'a'.repeat(32),
      for: `${'Do'.padEnd(118, ' more')}.`,
      scope: 'files.everything',
      says: { 'files.everything': 'Do everything with the files of the account.' },
    };
    const h = consentHarnessAt(served(), { way: { ...filesWay, more: [longest] } });
    const pending = await added(h, { provider: 'files', name: 'quarterly-files-archive-2' });
    const { url } = await startedAt(h, pending);
    await finishing(h, pending, await consentedAt(url));

    const words = await wordsOfReconnectingFor(h, pending.id, longest.name);

    expect([words.length, withinCharacters(words, mostOutcomeCharacters)]).toEqual([
      584,
      expect.stringContaining('never its address.'),
    ]);
  });
  it('say the link asks the person to allow the group as well, in the words of what it is for', async () => {
    const h = consentHarnessAt(served(), { way: growingWay });
    const { id } = await added(h, { provider: 'files' });

    expect(await wordsOfReconnectingFor(h, id, 'share')).toBe(
      'Gave a new link to the connection “files”; the link before it stops working. Show the person who added the connection a link named “Approve the Files connection”, never its address. On that page they approve it and give its credential where it takes one, within 24 hours. The link asks them to allow “share” as well: Share your files with other people.',
    );
  });

  it('say a connection connected stays connected until the person finishes on the page', async () => {
    const h = consentHarnessAt(served(), { way: growingWay });
    const id = await connectedFor(h);

    expect(await wordsOfReconnectingFor(h, id, 'delete')).toMatch(
      /^Gave a new link to the connection “files”, which stays connected as it is until the person finishes on the page and so replaces its credential; the link before it stops working\. Show the person who added the connection a link named “[^”]+”, never its address\. .* The link asks them to allow “delete” as well: Delete files you no longer need\.$/u,
    );
  });
});
