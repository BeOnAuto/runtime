import type { Permissions, Provider } from '@on.auto/providers';
import { drive, messages, providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import type { HadSources } from '@on.auto/tool-servers';
import { Function, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { providerCredentialChosen } from './chosen-provider-ways.ts';

const noSource: HadSources = { sourcesOf: () => [], sourceOf: Function.constUndefined };

const everySource: HadSources = { sourcesOf: () => ['gateway'], sourceOf: () => 'gateway' };

interface Asking {
  readonly provider: Provider;
  readonly placeholders: Readonly<Record<string, string>> | null;
  readonly kind: string;
  readonly permissions?: Permissions;
  readonly consent: HadSources;
}

function chosenOf({ provider, placeholders, kind, permissions, consent }: Asking) {
  const listing = {
    providers: providerListOf(provider),
    policy: connectionPolicyOf({}),
    providerValues: new Map(),
    consent,
  };
  const asked = { credential: { kind, permissions } };
  return providerCredentialChosen(provider, { name: 'chosen', placeholders }, asked, listing);
}

function refusalOf(asking: Asking) {
  const chosen = chosenOf(asking);
  return Result.isFailure(chosen) ? chosen.failure : chosen.success;
}

const driveProvider = providerOf(drive);

const messagesProvider = providerOf(messages);

const throughTheGateway = {
  provider: messagesProvider,
  placeholders: {},
  kind: 'authorization',
  permissions: 'application',
} as const;

describe('the credential of the way chosen of a provider', () => {
  it('is made from the way, its permissions and the words of its scopes, under the organization’s own OAuth client where no client covers it here', () => {
    const chosen = chosenOf({ provider: driveProvider, placeholders: null, kind: 'authorization', consent: noSource });

    expect(Result.getOrThrow(chosen)).toMatchObject({
      credential: {
        kind: 'authorization',
        permissions: 'delegated',
        client_source: 'own',
        scope: 'files.read files.write',
      },
      says: { 'files.read': 'Read the files of the account.' },
    });
  });

  it('goes through the gateway its provider names, where this runtime has one', () => {
    expect(Result.getOrThrow(chosenOf({ ...throughTheGateway, consent: everySource }))).toMatchObject({
      credential: { client_source: 'gateway', permissions: 'application' },
    });
  });

  it.each([
    ['through a gateway this runtime does not have', { ...throughTheGateway, consent: noSource }, '/credential'],
    [
      'asking for a value the connection never gave',
      { provider: providerOf(tracker), placeholders: {}, kind: 'secret', consent: noSource },
      '/placeholders/site',
    ],
  ] as const)('is refused %s, as invalid input at its pointer', (_case, asking, pointer) => {
    expect(refusalOf(asking)).toMatchObject({ _tag: 'invalid_input', issues: [{ pointer }] });
  });
});
