import type { AppRuntime } from '@on.auto/api';
import { makeClientRegistrations } from '@on.auto/connections';
import type { SecretStore } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import { makeConsentClient, type ConsentClient } from '@on.auto/tool-servers';

import type { Settings } from '../settings/settings.ts';
import { outboundFetch } from './outbound-fetch.ts';
import { runtimeLedger } from './runtime-ledger.ts';

export function consentClientOf(
  runtime: AppRuntime<DispatcherServices>,
  { registeredClients, signIn }: Pick<Settings, 'registeredClients' | 'signIn'>,
  secrets: SecretStore,
): ConsentClient {
  return makeConsentClient({
    fetch: outboundFetch,
    registeredClients,
    publicUrl: signIn?.publicUrl,
    registrations: makeClientRegistrations({ registry: runtimeLedger(runtime), secrets }),
  });
}
