import { clientMetadataRoutes, type AppRuntime, type RegisterRoutes } from '@on.auto/api';
import {
  makeConnectionOperations,
  makeConnectionSource,
  makeProviderOffering,
  type ConnectionOperations,
  type ConnectionServices,
  type RuntimeAccess,
} from '@on.auto/connections';
import { accessModeOf } from '@on.auto/identity';
import type { SecretStore } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import type { DatabaseSettings } from '@on.auto/workflow-host';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { consentClientOf, servedClientMetadataDocumentOf } from '../composition/served-consent.ts';
import { ledgerStoresOpenedBy, type LedgerStores } from '../database/ledger-stores.ts';
import type { Settings } from '../settings/settings.ts';

export interface StoresAndConnections {
  readonly stores: LedgerStores;
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly connections: ConnectionOperations;
  readonly source: ReturnType<typeof makeConnectionSource>;
  readonly offering: ReturnType<typeof makeProviderOffering>;
  readonly clientMetadata: RegisterRoutes;
}

type ServingSettings = Pick<
  Settings,
  | 'connections'
  | 'connectionVariables'
  | 'providers'
  | 'providerValues'
  | 'toolServers'
  | 'modelProviders'
  | 'signIn'
  | 'apiKeys'
  | 'host'
  | 'accessMode'
  | 'studio'
  | 'registeredClients'
>;

function accessOf({ host, signIn, apiKeys, accessMode }: ServingSettings): RuntimeAccess {
  if (accessModeOf({ host, apiKeys, signsIn: signIn !== undefined, accessMode }) === 'local') {
    return 'local';
  }
  return signIn === undefined ? 'keys' : 'people';
}

interface Composed {
  readonly secrets: SecretStore;
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly pages: ConnectionServices['pages'];
}

function connectionServicesOf(settings: ServingSettings, { secrets, consent, pages }: Composed): ConnectionServices {
  return {
    consent,
    secrets,
    policy: settings.connections,
    fileEntries: settings.toolServers.servers.map(({ name }) => name),
    modelProviders: settings.modelProviders,
    providers: settings.providers,
    providerValues: settings.providerValues,
    pages,
    access: accessOf(settings),
  };
}

function sourceServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: ServingSettings,
  { secrets, pages }: Omit<Composed, 'consent'>,
): ReturnType<typeof makeConnectionSource> {
  return makeConnectionSource({
    registry: runtimeLedger(runtime),
    secrets,
    policy: settings.connections,
    pages,
    variables: settings.connectionVariables,
    modelProviders: settings.modelProviders,
    providers: settings.providers,
    providerValues: settings.providerValues,
  });
}

export async function storesAndConnectionsOf(
  runtime: AppRuntime<DispatcherServices>,
  settings: Settings,
  database: DatabaseSettings,
  ownOrigin: () => string,
): Promise<StoresAndConnections> {
  const stores = await ledgerStoresOpenedBy(runtime.context, settings, database);
  const consent = consentClientOf(runtime, settings, stores.secrets);
  const pages = { studio: settings.studio, runtime: ownOrigin };
  const services = connectionServicesOf(settings, { secrets: stores.secrets, consent, pages });
  return {
    stores,
    consent,
    connections: makeConnectionOperations(services),
    source: sourceServedBy(runtime, settings, { secrets: stores.secrets, pages }),
    offering: makeProviderOffering(services),
    clientMetadata: clientMetadataRoutes(servedClientMetadataDocumentOf(settings, pages)),
  };
}
