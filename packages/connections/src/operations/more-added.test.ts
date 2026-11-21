import type { Outcome, RegisteredPlainLanguage } from '@on.auto/operations';
import { consentedAt, type FakeMcpServer, registeredAt } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, type Added, adding, crm, issuesIn, reconnectedFor, reconnectingFor } from '../testing/additions.ts';
import {
  connectedThrough,
  consentFake,
  consentHarnessAt,
  filesWay,
  finishing,
  sharing,
  sharingWay,
  startedAt,
} from '../testing/consents.ts';
import { ada, harness, type Harness, operationNamed } from '../testing/harness.ts';

const anyWords: unknown = expect.any(String);

const closing: (() => Promise<void>)[] = [];

const sharingToo = { provider: 'files', more: 'share' };

const bothSaid = [
  { name: 'files.read', says: 'Read the files of the account.' },
  { name: 'files.share', says: sharing.says['files.share'] },
];

function served(): FakeMcpServer {
  const fake = consentFake({ dynamicRegistration: true });
  closing.push(fake.close);
  return fake;
}

function sharingHarness(): Harness {
  return consentHarnessAt(served(), { way: sharingWay });
}

function reading(h: Harness, { id, token }: Added): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'read_link'), ada, { id, token });
}

function gotten(h: Harness, { id }: Added): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
}

function notNamed(names: string) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'The connection cannot be added as it is given',
    issues: [
      { pointer: '/more', detail: `Expected a group the way of the connection files names in more, which is ${names}` },
    ],
  };
}

function addingWords(h: Harness): RegisteredPlainLanguage {
  const { registration } = operationNamed(h.operations, 'add_connection');
  if (!('plainLanguage' in registration) || registration.plainLanguage === undefined) {
    throw new Error('add_connection has no words');
  }
  return registration.plainLanguage;
}

async function wordsOfAdding(h: Harness, input: Readonly<Record<string, unknown>>): Promise<string> {
  const outcome = await adding(h, input);
  return addingWords(h).outcome('output' in outcome ? outcome.output : undefined, input);
}

function harnessOf(way: Readonly<Record<string, unknown>>): Harness {
  return consentHarnessAt(served(), { way });
}

function notNamedMoreRefused(names: string) {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: 'The connection cannot be reconnected as it is given',
    issues: [
      { pointer: '/more', detail: `Expected a group the way of the connection files names in more, which is ${names}` },
    ],
  };
}

describe('more added', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('a connection added with a group of more', () => {
    it('records the group on its link, and is read on the page with the group’s scopes and words beside the first consent’s', async () => {
      const h = sharingHarness();

      const link = await added(h, sharingToo);
      const issued = (await h.facts()).at(-1);
      const read = await reading(h, link);

      expect(issued).toMatchObject({ type: 'connection_link_issued', data: { connection: link.id, more: 'share' } });
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

    it('asks both in its one consent, holds both among its asked_scopes once the consent starts, and connects granted both', async () => {
      const h = sharingHarness();
      const link = await added(h, sharingToo);

      const { url } = await startedAt(h, link);
      const started = await gotten(h, link);
      const finished = await finishing(h, link, await consentedAt(url));

      expect(new URL(url).searchParams.get('scope')).toBe('files.read files.share');
      expect(started).toMatchObject({ output: { status: 'pending', asked_scopes: bothSaid } });
      expect(finished).toMatchObject({
        status: 'succeeded',
        output: { status: 'connected', asked_scopes: bothSaid, granted_scope: 'files.read files.share' },
      });
    });
  });

  describe('a connection added with a group of more it cannot ask', () => {
    it('is refused where its way names no such group, or none, and records nothing', async () => {
      const growing = sharingHarness();
      const plain = consentHarnessAt(served(), { way: filesWay });

      expect([await adding(growing, { provider: 'files', more: 'delete' }), await adding(plain, sharingToo)]).toEqual([
        notNamed('“share”'),
        notNamed('none'),
      ]);
      expect([await growing.facts(), await plain.facts()]).toEqual([[], []]);
    });

    it('is refused where no client set up here covers what its consent would ask', async () => {
      const fake = served();
      const readingAlone = consentHarnessAt(fake, {
        way: sharingWay,
        consenting: { registeredClients: [registeredAt(fake.origin, { scopes: ['files.read'] })] },
      });

      expect(await adding(readingAlone, sharingToo)).toEqual({
        status: 'rejected',
        reason: 'conflict',
        detail: anyWords,
      });
    });

    it('is refused at more where it is given by hand, which offers no group of more', async () => {
      expect(issuesIn(await adding(harness(), { ...crm, more: 'share' }))).toEqual([
        {
          pointer: '/more',
          detail: anyWords,
        },
      ]);
    });
  });

  describe('the words of adding a connection with a group of more', () => {
    it('say its link asks the person to allow the group as well, in the words of what it is for', async () => {
      expect(await wordsOfAdding(sharingHarness(), sharingToo)).toBe(
        'Added the connection “files”. Show the person who added the connection a link named “Approve the Files connection”, never its address. On that page they approve it and give its credential where it takes one, within 24 hours. The link asks them to allow “share” as well: Share your files with other people.',
      );
    });
  });
});

describe('more refused', () => {
  afterEach(async () => {
    await Promise.all(closing.splice(0).map((close) => close()));
  });

  describe('reconnecting a connection for more', () => {
    it('refuses a group its way does not name, and any group of a way that names none', async () => {
      const growing = harnessOf(sharingWay);
      const plain = harnessOf(filesWay);
      const [first, second] = [await added(growing, { provider: 'files' }), await added(plain, { provider: 'files' })];

      expect([
        await reconnectingFor(growing, first.id, 'delete'),
        await reconnectingFor(plain, second.id, 'share'),
      ]).toEqual([notNamedMoreRefused('“share”'), notNamedMoreRefused('none')]);
    });

    it('refuses a group whose every scope the connection holds already', async () => {
      const h = harnessOf(sharingWay);
      const link = await added(h, { provider: 'files' });
      await connectedThrough(h, await reconnectedFor(h, link.id, 'share'));

      expect(await reconnectingFor(h, link.id, 'share')).toMatchObject({
        status: 'rejected',
        reason: 'conflict',
        detail: anyWords,
      });
    });
  });

  describe('reconnecting a connection for more that cannot be asked here', () => {
    it('refuses a connection removed, and one no client set up here covers what a consent for the group would ask', async () => {
      const h = harnessOf(sharingWay);
      const fake = served();
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
          detail: anyWords,
        },
        {
          status: 'rejected',
          reason: 'conflict',
          detail: anyWords,
        },
      ]);
    });
  });
});
