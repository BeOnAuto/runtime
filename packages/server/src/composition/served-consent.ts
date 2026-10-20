import type { AppRuntime } from '@on.auto/api';
import { makeClientRegistrations, returnAddressOf, type ConnectPages } from '@on.auto/connections';
import type { DispatcherServices } from '@on.auto/operations';
import type { SecretStore } from '@on.auto/secrets';
import {
  clientMetadataDocumentOf,
  makeConsentClient,
  type ClientMetadataDocument,
  type ConsentClient,
} from '@on.auto/tool-servers';

import type { Settings } from '../settings/settings.ts';
import { outboundFetch } from './outbound-fetch.ts';
import { runtimeLedger } from './runtime-ledger.ts';

type PublicAddressing = Pick<Settings, 'signIn'>;

function publicUrlOf({ signIn }: PublicAddressing): string | undefined {
  return signIn?.publicUrl;
}

export function consentClientOf(
  runtime: AppRuntime<DispatcherServices>,
  settings: Pick<Settings, 'registeredClients' | 'signIn'>,
  secrets: SecretStore,
): ConsentClient {
  return makeConsentClient({
    fetch: outboundFetch,
    registeredClients: settings.registeredClients,
    publicUrl: publicUrlOf(settings),
    registrations: makeClientRegistrations({ registry: runtimeLedger(runtime), secrets }),
  });
}

export function servedClientMetadataDocumentOf(
  settings: PublicAddressing,
  pages: ConnectPages,
): ClientMetadataDocument | undefined {
  return clientMetadataDocumentOf(publicUrlOf(settings), returnAddressOf(pages));
}
