import { registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, reconnectedFor, reconnectingFor } from '../testing/additions.ts';
import { connectedThrough, consentFake, consentHarnessAt, filesWay, sharingWay } from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake({ dynamicRegistration: true });
  closing.push(fake.close);
  return fake;
}

async function harnessOf(way: Readonly<Record<string, unknown>>): Promise<Harness> {
  return consentHarnessAt(await served(), { way });
}

function notNamed(names: string) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'The connection cannot be reconnected as it is given',
    issues: [
      { pointer: '/more', detail: `Expected a group the way of the connection files names in more, which is ${names}` },
    ],
  };
}

describe('reconnecting a connection for more', () => {
  it('refuses a group its way does not name, and any group of a way that names none', async () => {
    const growing = await harnessOf(sharingWay);
    const plain = await harnessOf(filesWay);
    const [first, second] = [await added(growing, { provider: 'files' }), await added(plain, { provider: 'files' })];

    expect([
      await reconnectingFor(growing, first.id, 'delete'),
      await reconnectingFor(plain, second.id, 'share'),
    ]).toEqual([notNamed('“share”'), notNamed('none')]);
  });

  it('refuses a group whose every scope the connection holds already', async () => {
    const h = await harnessOf(sharingWay);
    const link = await added(h, { provider: 'files' });
    await connectedThrough(h, await reconnectedFor(h, link.id, 'share'));

    expect(await reconnectingFor(h, link.id, 'share')).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The connection files holds every scope of “share” already, so a link for it would ask nothing more',
    });
  });
});

describe('reconnecting a connection for more that cannot be asked here', () => {
  it('refuses a connection removed, and one no client set up here covers what a consent for the group would ask', async () => {
    const h = await harnessOf(sharingWay);
    const fake = await served();
    const readingAlone = consentHarnessAt(fake, {
      way: sharingWay,
      consenting: { registeredClients: [registeredAt(fake.origin, { scopes: ['files.read'] })] },
    });
    const { id } = await added(h, { provider: 'files' });
    const uncovered = await added(readingAlone, { provider: 'files' });
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect([
      await reconnectingFor(h, id, 'share'),
      await reconnectingFor(readingAlone, uncovered.id, 'share'),
    ]).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The connection files is removed, so it is added again rather than reconnected',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          'The connection files cannot be granted “share”, since no client set up here covers every scope its consent would ask, files.read files.share',
      },
    ]);
  });
});
