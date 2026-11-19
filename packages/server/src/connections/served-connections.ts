import { clientMetadataRoutes, type RegisterRoutes } from '@on.auto/api';
import {
  makeConnectionOperations,
  makeConnectionSource,
  makeProviderOffering,
  type ConnectionOperations,
  type ConnectionServices,
  type RuntimeAccess,
} from '@on.auto/connections';
import { accessModeOf } from '@on.auto/identity';

import { outboundFetch } from '../composition/outbound-fetch.ts';
import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { consentClientOf, servedClientMetadataDocumentOf } from '../composition/served-consent.ts';
import { ledgerStoresOpenedBy, type LedgerStores } from '../database/ledger-stores.ts';
import { licenseServedBy, type ServedLicense } from '../licensing/served-license.ts';
import { ownKeysOf, secretsKeptBy, type OwnKeysRead } from '../secrets/own-keys.ts';
import type { Settings } from '../settings/settings.ts';

interface ServedConnectionOperations {
  readonly connections: ConnectionOperations;
  readonly offering: ReturnType<typeof makeProviderOffering>;
}

type ReadOnceThrough = ConnectionServices['readOnceThrough'];

export interface StoresAndConnections extends OwnKeysRead {
  readonly stores: LedgerStores;
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly connectionsReadingThrough: (readOnceThrough: ReadOnceThrough) => ServedConnectionOperations;
  readonly source: ReturnType<typeof makeConnectionSource>;
  readonly clientMetadata: RegisterRoutes;
  readonly license: ServedLicense;
  readonly studioAddress: { readonly studio: Settings['studio']; readonly runtime: () => string };
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

function policyServedAt(settings: ServingSettings): ConnectionServices['policy'] {
  return { ...settings.connections, loopbackAllowed: accessOf(settings) === 'local' };
}

interface Composed {
  readonly secrets: LedgerStores['secrets'];
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly pages: ConnectionServices['pages'];
  readonly readOnceThrough: ReadOnceThrough;
}

function connectionServicesOf(
  settings: ServingSettings,
  { secrets, consent, pages, readOnceThrough }: Composed,
): ConnectionServices {
  return {
    consent,
    secrets,
    policy: policyServedAt(settings),
    fileEntries: settings.toolServers.servers.map(({ name }) => name),
    modelProviders: settings.modelProviders,
    providers: settings.providers,
    providerValues: settings.providerValues,
    variables: settings.connectionVariables,
    pages,
    access: accessOf(settings),
    fetch: outboundFetch,
    readOnceThrough,
  };
}

function sourceServedBy(
  runtime: Parameters<typeof runtimeLedger>[0],
  settings: ServingSettings,
  { secrets, pages }: Pick<Composed, 'secrets' | 'pages'>,
): ReturnType<typeof makeConnectionSource> {
  return makeConnectionSource({
    registry: runtimeLedger(runtime),
    secrets,
    policy: policyServedAt(settings),
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
  database: Parameters<typeof ledgerStoresOpenedBy>[2],
  ownOrigin: () => string,
): Promise<StoresAndConnections> {
  const stores = await ledgerStoresOpenedBy(runtime.context, settings, database);
  const ownKeys = await ownKeysOf(runtime, stores.secrets, secretsKeptBy(settings));
  const consent = consentClientOf(runtime, settings, stores.secrets);
  const pages = { studio: settings.studio, runtime: ownOrigin };
  return {
    stores,
    ...ownKeys,
    consent,
    connectionsReadingThrough: (readOnceThrough) => {
      const services = connectionServicesOf(settings, { secrets: stores.secrets, consent, pages, readOnceThrough });
      return { connections: makeConnectionOperations(services), offering: makeProviderOffering(services) };
    },
    source: sourceServedBy(runtime, settings, { secrets: stores.secrets, pages }),
    clientMetadata: clientMetadataRoutes(servedClientMetadataDocumentOf(settings, pages)),
    license: await licenseServedBy(runtime, settings.license, stores.secrets),
    studioAddress: pages,
  };
}
