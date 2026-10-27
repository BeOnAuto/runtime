import { clientMetadataRoutes, type RegisterRoutes, type RetryStateKeys } from '@on.auto/api';
import {
  makeConnectionOperations,
  makeConnectionSource,
  makeProviderOffering,
  type ConnectionOperations,
  type ConnectionServices,
  type RuntimeAccess,
} from '@on.auto/connections';
import { accessModeOf } from '@on.auto/identity';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { consentClientOf, servedClientMetadataDocumentOf } from '../composition/served-consent.ts';
import type { LedgerDatabase } from '../database/ledger-database.ts';
import { ledgerStoresOpenedBy, type LedgerStores } from '../database/ledger-stores.ts';
import { licenseServedBy, type ServedLicense } from '../licensing/served-license.ts';
import { retryStateKeysOf, secretsKeptBy } from '../secrets/own-keys.ts';
import type { Settings } from '../settings/settings.ts';

export interface StoresAndConnections {
  readonly stores: LedgerStores;
  readonly retryStateKeys: RetryStateKeys;
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly connections: ConnectionOperations;
  readonly source: ReturnType<typeof makeConnectionSource>;
  readonly offering: ReturnType<typeof makeProviderOffering>;
  readonly clientMetadata: RegisterRoutes;
  readonly license: ServedLicense;
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
  | 'license'
>;

function accessOf({ host, signIn, apiKeys, accessMode }: ServingSettings): RuntimeAccess {
  if (accessModeOf({ host, apiKeys, signsIn: signIn !== undefined, accessMode }) === 'local') {
    return 'local';
  }
  return signIn === undefined ? 'keys' : 'people';
}

interface Composed {
  readonly secrets: LedgerStores['secrets'];
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
  runtime: Parameters<typeof runtimeLedger>[0],
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
  runtime: Parameters<typeof licenseServedBy>[0],
  settings: Settings,
  database: LedgerDatabase,
  ownOrigin: () => string,
): Promise<StoresAndConnections> {
  const stores = await ledgerStoresOpenedBy(runtime.context, settings, database);
  const retryStateKeys = await retryStateKeysOf(runtime, stores.secrets, secretsKeptBy(settings));
  const consent = consentClientOf(runtime, settings, stores.secrets);
  const pages = { studio: settings.studio, runtime: ownOrigin };
  const services = connectionServicesOf(settings, { secrets: stores.secrets, consent, pages });
  return {
    stores,
    retryStateKeys,
    consent,
    connections: makeConnectionOperations(services),
    source: sourceServedBy(runtime, settings, { secrets: stores.secrets, pages }),
    offering: makeProviderOffering(services),
    clientMetadata: clientMetadataRoutes(servedClientMetadataDocumentOf(settings, pages)),
    license: await licenseServedBy(runtime, settings.license.key, stores.secrets),
  };
}
