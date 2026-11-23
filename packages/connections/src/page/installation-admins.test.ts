import type { FakeMcpServer } from '@on.auto/tool-servers/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { Added } from '../testing/additions.ts';
import { consentedOf } from '../testing/consents.ts';
import type { Harness } from '../testing/harness.ts';
import {
  answersToThePerson,
  filesOf,
  finishingWith,
  installingFake,
  installingHarnessAt,
  signedInAgainFor,
  typesOf,
  unadministered,
  type InstallingFake,
} from '../testing/installing-consents.ts';

const anyWords: unknown = expect.any(String);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function installing(answers?: Parameters<typeof installingFake>[1]): InstallingFake {
  const made = installingFake(undefined, answers);
  closing.push(made.fake.close);
  return made;
}

function askedAt(fake: FakeMcpServer): readonly string[] {
  return fake
    .heard()
    .map(({ path }) => path)
    .filter((path) => path === '/me' || path.startsWith('/memberships/'));
}

describe('the installations listed to the person who signed in, each marked whether they administer its account', () => {
  it('are marked by asking who the person is once, and the membership of each organization once', async () => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);

    await finishingWith(h, link, await consentedOf(h, link));

    expect(askedAt(made.fake).toSorted()).toEqual([
      '/me',
      '/memberships/acme',
      '/memberships/acme-archive',
      '/memberships/acme-labs',
      '/memberships/acme-partners',
      '/memberships/acme-research',
      '/memberships/acme-ventures',
    ]);
  });
});

describe('an installation the person chose on an account they administer', () => {
  it.each([
    ['an organization they are an active admin of', '42', 'acme-labs', ['/memberships/acme-labs']],
    ['their own personal account', '47', 'ada', ['/me']],
  ] as const)('is connected on %s, asking only about that account', async (_case, id, name, asked) => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);

    const finished = await finishingWith(h, link, { ...(await consentedOf(h, link)), installation: id });

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', installation: { id, name } },
    });
    expect(askedAt(made.fake)).toEqual(asked);
  });
});

const unadministeredOnEachPath = unadministered.flatMap(([account, id]) => [
  [
    `chosen among those listed, on ${account}`,
    async (h: Harness, link: Added) => ({ ...(await consentedOf(h, link)), installation: id }),
  ] as const,
  [
    `returned after an installation, on ${account}`,
    (h: Harness, link: Added) => signedInAgainFor(h, link, id),
  ] as const,
]);

describe('an installation on an account the person who signed in does not administer', () => {
  it.each(unadministeredOnEachPath)(
    'is refused at /installation, %s, connecting nothing',
    async (_case, returnedTo) => {
      const made = installing();
      const h = installingHarnessAt(made);
      const link = await filesOf(h);

      const finished = await finishingWith(h, link, await returnedTo(h, link));

      expect(finished).toMatchObject({
        status: 'rejected',
        reason: 'invalid_input',
        issues: [{ pointer: '/installation', detail: anyWords }],
      });
      expect(await typesOf(h)).not.toContain('connection_connected');
    },
  );
});

describe('a finish where the service does not confirm who administers the accounts of the installations', () => {
  it.each([
    ['who the person is', '/me'],
    ['the person’s membership of an organization', '/memberships/acme'],
  ] as const)('is unavailable where the service does not answer %s, connecting nothing', async (_case, path) => {
    const failing = { ...answersToThePerson, [path]: { status: 502, body: { message: 'Bad Gateway' } } };
    const h = installingHarnessAt(installing(failing));
    const link = await filesOf(h);

    expect(await finishingWith(h, link, await consentedOf(h, link))).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
    });
    expect(await typesOf(h)).not.toContain('connection_connected');
  });
});
