import type { CallerIdentity } from '@on.auto/operations';
import { fixtureProviders } from '@on.auto/providers/testing';
import { consentClientWith } from '@on.auto/tool-servers/testing';
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
}

function offeredBy(access: RuntimeAccess, { policy = {}, providerValues = new Map() }: RuntimeSettings = {}) {
  const offering = makeProviderOffering({
    providers: fixtureProviders,
    providerValues,
    policy: connectionPolicyOf(policy),
    access,
    pages: harnessPages,
    consent: consentClientWith(),
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
