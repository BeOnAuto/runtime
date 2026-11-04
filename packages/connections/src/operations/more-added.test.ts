import type { Outcome, RegisteredPlainLanguage } from '@on.auto/operations';
import { consentedAt, registeredAt, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { added, adding, crm, issuesIn, type Added } from '../testing/additions.ts';
import {
  consentFake,
  consentHarnessAt,
  filesWay,
  finishing,
  sharing,
  sharingWay,
  startedAt,
} from '../testing/consents.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const sharingToo = { provider: 'files', more: 'share' };

const bothSaid = [
  { name: 'files.read', says: 'Read the files of the account.' },
  { name: 'files.share', says: sharing.says['files.share'] },
];

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake({ dynamicRegistration: true });
  closing.push(fake.close);
  return fake;
}

async function sharingHarness(): Promise<Harness> {
  return consentHarnessAt(await served(), { way: sharingWay });
}

function reading(h: Harness, { id, token }: Added): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'read_link'), ada, { id, token });
}

function gotten(h: Harness, { id }: Added): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
}

describe('a connection added with a group of more', () => {
  it('records the group on its link, and is read on the page with the group’s scopes and words beside the first consent’s', async () => {
    const h = await sharingHarness();

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
    const h = await sharingHarness();
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

describe('a connection added with a group of more it cannot ask', () => {
  it('is refused where its way names no such group, or none, and records nothing', async () => {
    const growing = await sharingHarness();
    const plain = consentHarnessAt(await served(), { way: filesWay });

    expect([await adding(growing, { provider: 'files', more: 'delete' }), await adding(plain, sharingToo)]).toEqual([
      notNamed('“share”'),
      notNamed('none'),
    ]);
    expect([await growing.facts(), await plain.facts()]).toEqual([[], []]);
  });

  it('is refused where no client set up here covers what its consent would ask', async () => {
    const fake = await served();
    const readingAlone = consentHarnessAt(fake, {
      way: sharingWay,
      consenting: { registeredClients: [registeredAt(fake.origin, { scopes: ['files.read'] })] },
    });

    expect(await adding(readingAlone, sharingToo)).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The connection files cannot be granted “share”, since no client set up here covers every scope its consent would ask, files.read files.share',
    });
  });

  it('is refused at more where it is given by hand, which offers no group of more', async () => {
    expect(issuesIn(await adding(harness(), { ...crm, more: 'share' }))).toEqual([
      {
        pointer: '/more',
        detail:
          'Expected no more without provider: an addition by hand offers no group of more, since only a provider names one',
      },
    ]);
  });
});

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

describe('the words of adding a connection with a group of more', () => {
  it('say its link asks the person to allow the group as well, in the words of what it is for', async () => {
    expect(await wordsOfAdding(await sharingHarness(), sharingToo)).toMatch(
      /^Added the connection “files”, whose link asks the person to allow “share” as well: Share your files with other people\. The person who added it approves it/u,
    );
  });
});
