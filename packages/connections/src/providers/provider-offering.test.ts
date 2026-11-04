import type { CallerIdentity } from '@on.auto/operations';
import { drive, fixtureProviders, providersOf } from '@on.auto/providers/testing';
import type { ConsentClient } from '@on.auto/tool-servers';
import { consentClientWith, registeredAt } from '@on.auto/tool-servers/testing';
import { Effect, type Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import type { RuntimeAccess } from '../policy/policy-rules.ts';
import { ada, developerTokenSet, harnessPages } from '../testing/harness.ts';

const acmeKey: CallerIdentity = { ...ada, id: 'acme-key' };

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read'] };

interface RuntimeSettings {
  readonly policy?: ConnectionPolicyFields;
  readonly providerValues?: ReadonlyMap<string, Redacted.Redacted>;
  readonly providers?: typeof fixtureProviders;
  readonly consent?: ConsentClient;
}

function offeredBy(access: RuntimeAccess, settings: RuntimeSettings = {}) {
  const {
    policy = {},
    providerValues = new Map(),
    providers = fixtureProviders,
    consent = consentClientWith(),
  } = settings;
  const offering = makeProviderOffering({
    providers,
    providerValues,
    policy: connectionPolicyOf(policy),
    access,
    pages: harnessPages,
    consent,
  });
  return (caller: CallerIdentity) => Effect.runSync(offering(caller));
}

function namesOf(offered: readonly { readonly name: string }[] | undefined): readonly string[] | undefined {
  return offered?.map(({ name }) => name);
}

describe('the providers offered to a caller', () => {
  it('are, to a caller who may add, every provider listed here with a way offered, by name, with its title and description', () => {
    expect(offeredBy('people')(ada)).toEqual([
      { name: 'ledgers', title: 'Ledgers', description: 'Read and post the journal entries of one tenant.' },
      {
        name: 'regions',
        title: 'Regions',
        description: 'Read the campaigns of one account, in the region it is kept in.',
      },
      { name: 'tracker', title: 'Tracker', description: 'Read and change issues, projects and comments.' },
    ]);
    expect(namesOf(offeredBy('local')(acmeKey))).toEqual(['ledgers', 'regions', 'tracker']);
  });

  it('take in a provider once the value whoever runs the runtime sets for its ways is set', () => {
    expect(namesOf(offeredBy('people', { providerValues: developerTokenSet })(ada))).toEqual([
      'ledgers',
      'metrics',
      'regions',
      'tracker',
    ]);
  });

  it('are those the rules of the runtime could allow, as list_providers lists them', () => {
    expect(namesOf(offeredBy('people', { policy: { allowed_hosts: ['*.tracker.example.com'] } })(ada))).toEqual([
      'tracker',
    ]);
    expect(namesOf(offeredBy('people', { policy: { allowed_hosts: [] } })(ada))).toEqual([]);
  });

  it('are none to a key where people sign in, to a reader, on a runtime that signs nobody in, and where people may not add', () => {
    expect([
      offeredBy('people')(acmeKey),
      offeredBy('people')(adaReading),
      offeredBy('keys')(ada),
      offeredBy('people', { policy: { people_may_add: false } })(ada),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

function driveOfferedWith(scopes: readonly string[]) {
  const registered = registeredAt('https://accounts.drive.example.com', { scopes });
  const consent = consentClientWith({ registeredClients: [registered] });
  return namesOf(offeredBy('people', { providers: providersOf(drive), consent })(ada));
}

describe('the providers of consent offered to a caller', () => {
  it('take in a provider whether or not a client registered at its issuer names every scope its way asks, since the organization’s own OAuth client covers it where none does', () => {
    expect([driveOfferedWith(['files.read']), driveOfferedWith(['files.write', 'files.read'])]).toEqual([
      ['drive'],
      ['drive'],
    ]);
  });
});

const driveSharing = {
  name: 'drive',
  title: 'Drive',
  description: 'Read and change the files of an account.',
  website: 'https://developer.drive.example.com/mcp',
  type: 'mcp',
  url: 'https://mcp.drive.example.com/mcp',
  credentials: [
    {
      kind: 'authorization',
      issuer: 'https://accounts.drive.example.com',
      scope: 'files.read files.write',
      says: {
        'files.read': 'Read the files of the account.',
        'files.write': 'Create and change the files of the account.',
      },
      more: [
        {
          name: 'share',
          for: 'Share your files with other people.',
          scope: 'files.share',
          says: { 'files.share': 'Share the files of the account with other people.' },
        },
      ],
      description: 'Sign in to Drive and allow Auto to read and change your files.',
    },
  ],
};

describe('the groups of more a provider offers', () => {
  it('are offered with the provider, each by name and what it is for, so an agent can ask for one with add_connection', () => {
    const registered = registeredAt('https://accounts.drive.example.com', {
      scopes: ['files.read', 'files.write', 'files.share'],
    });
    const consent = consentClientWith({ registeredClients: [registered] });

    expect(offeredBy('people', { providers: providersOf(driveSharing), consent })(ada)).toEqual([
      {
        name: 'drive',
        title: 'Drive',
        description: 'Read and change the files of an account.',
        more: [{ name: 'share', for: 'Share your files with other people.' }],
      },
    ]);
  });
});
