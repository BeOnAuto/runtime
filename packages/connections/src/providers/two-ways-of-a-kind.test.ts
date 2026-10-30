import { drive, providersOf } from '@on.auto/providers/testing';
import { registeredAt } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { adding } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const registeredClients = [registeredAt('https://accounts.drive.example.com')];

const [driveWay] = drive.credentials;

const readingWay = {
  ...driveWay,
  scope: 'files.read',
  says: { 'files.read': 'Read the files of the account.' },
  description: 'Sign in to Drive and allow Auto to read your files.',
};

const files = { ...drive, name: 'files', credentials: [driveWay, readingWay] };

function twoWaysHarness(): Harness {
  return harness({ providers: providersOf(files), consenting: { registeredClients } });
}

describe('the listing of a provider with two ways of consent', () => {
  it('answers both ways, each with its scope, its words and what the person is told', async () => {
    const h = twoWaysHarness();

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            name: 'files',
            credentials: [
              {
                kind: 'authorization',
                scope: 'files.read files.write',
                description: 'Sign in to Drive and allow Auto to read and change your files.',
                offered: true,
              },
              {
                kind: 'authorization',
                scope: 'files.read',
                scopes: [{ name: 'files.read', says: 'Read the files of the account.' }],
                description: 'Sign in to Drive and allow Auto to read your files.',
                offered: true,
              },
            ],
          },
        ],
      },
    });
  });
});

describe('a connection added by a provider with two ways of consent', () => {
  it('is added by its first way where the caller names the kind alone, and by the way whose scope the caller names', async () => {
    const h = twoWaysHarness();

    const [byKind, byScope] = [
      await adding(h, { provider: 'files', name: 'files-changed', credential: { kind: 'authorization' } }),
      await adding(h, {
        provider: 'files',
        name: 'files-read',
        credential: { kind: 'authorization', scope: 'files.read' },
      }),
    ];

    expect([byKind, byScope]).toMatchObject([
      { output: { name: 'files-changed', credential: { scope: 'files.read files.write' } } },
      { output: { name: 'files-read', credential: { scope: 'files.read' } } },
    ]);
  });

  it('is refused a scope none of its ways asks, at the scope', async () => {
    const answer = await adding(twoWaysHarness(), {
      provider: 'files',
      credential: { kind: 'authorization', scope: 'files.write' },
    });

    expect(answer).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/credential/scope',
          detail:
            'The provider files takes no authorization credential that asks files.write; it takes one that asks files.read files.write or one that asks files.read',
        },
      ],
    });
  });
});

const notCovered =
  'The provider files takes consent through a client whoever runs Auto registers, and no client set up here covers every scope its way asks, files.read files.write';

function readingClientHarness(): Harness {
  const readingClient = registeredAt('https://accounts.drive.example.com', { scopes: ['files.read'] });
  return harness({ providers: providersOf(files), consenting: { registeredClients: [readingClient] } });
}

describe('a provider with two ways of consent whose registered client covers the scope of one alone', () => {
  it('lists the other as not offered, because the client set up covers not every scope it asks', async () => {
    const h = readingClientHarness();

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            credentials: [
              { scope: 'files.read files.write', offered: false, because: notCovered },
              { scope: 'files.read', offered: true },
            ],
          },
        ],
      },
    });
  });

  it('takes the way offered where the caller names the kind alone, and refuses the other at the scope the caller names, in those words', async () => {
    const h = readingClientHarness();

    const [byKind, byScope] = [
      await adding(h, { provider: 'files', name: 'files-read', credential: { kind: 'authorization' } }),
      await adding(h, {
        provider: 'files',
        name: 'files-changed',
        credential: { kind: 'authorization', scope: 'files.read files.write' },
      }),
    ];

    expect([byKind, byScope]).toMatchObject([
      { output: { credential: { scope: 'files.read' } } },
      { status: 'rejected', issues: [{ pointer: '/credential/scope', detail: notCovered }] },
    ]);
  });

  it('refuses at the kind where the caller names the kind alone and no way of it is covered', async () => {
    const writingClient = registeredAt('https://accounts.drive.example.com', { scopes: ['files.write'] });
    const h = harness({ providers: providersOf(files), consenting: { registeredClients: [writingClient] } });

    expect(await adding(h, { provider: 'files', credential: { kind: 'authorization' } })).toMatchObject({
      status: 'rejected',
      issues: [{ pointer: '/credential/kind', detail: notCovered }],
    });
  });
});
