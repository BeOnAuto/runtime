import { drive, providersOf } from '@on.auto/providers/testing';
import { registeredAt } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { adding } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const issuer = 'https://accounts.drive.example.com';

const [driveWay] = drive.credentials;

const shareWords = 'Share the files of the account with other people.';

const sharing = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': shareWords },
};

const files = {
  ...drive,
  name: 'files',
  credentials: [{ ...driveWay, more: [sharing] }],
};

function harnessCovering(scopes?: readonly string[]): Harness {
  const client = scopes === undefined ? registeredAt(issuer) : registeredAt(issuer, { scopes });
  return harness({ providers: providersOf(files), consenting: { registeredClients: [client] } });
}

function waysListedBy(h: Harness) {
  return h.call(operationNamed(h.operations, 'list_providers'), ada);
}

const notCovered =
  'The provider files takes consent through a client whoever runs Auto registers, and no client set up here covers every scope its way asks, files.read files.write';

describe('the listing of a provider whose way names what a later consent may add', () => {
  it('answers the scopes its first consent asks and each group of more by its name, what it is for and the words of its scopes', async () => {
    expect(await waysListedBy(harnessCovering())).toMatchObject({
      output: {
        providers: [
          {
            name: 'files',
            credentials: [
              {
                kind: 'authorization',
                scopes: [
                  { name: 'files.read', says: 'Read the files of the account.' },
                  { name: 'files.write', says: 'Create and change the files of the account.' },
                ],
                more: [{ name: 'share', for: sharing.for, scopes: [{ name: 'files.share', says: shareWords }] }],
                offered: true,
              },
            ],
          },
        ],
      },
    });
  });
});

describe('a provider whose way names more, by the clients set up for it', () => {
  it('is offered and added where a client covers the scopes of its first consent, whether or not it covers a group of more', async () => {
    const h = harnessCovering(['files.read', 'files.write']);

    expect(await waysListedBy(h)).toMatchObject({
      output: { providers: [{ credentials: [{ offered: true }] }] },
    });
    expect(await adding(h, { provider: 'files' })).toMatchObject({
      status: 'succeeded',
      output: { credential: { scope: 'files.read files.write' } },
    });
  });

  it('is not offered, and is refused at the kind in words that name its scope, where no client covers its first consent', async () => {
    const h = harnessCovering(['files.read', 'files.share']);

    expect(await waysListedBy(h)).toMatchObject({
      output: { providers: [{ credentials: [{ offered: false, because: notCovered }] }] },
    });
    expect(await adding(h, { provider: 'files', credential: { kind: 'authorization' } })).toMatchObject({
      status: 'rejected',
      issues: [{ pointer: '/credential/kind', detail: notCovered }],
    });
  });
});
