import { clientMetadataRoutes, type RegisterRoutes } from '@on.auto/api';
import {
  makeConnectionOperations,
  makeConnectionSource,
  makeProviderOffering,
  socketChecksOver,
  type ConnectionOperations,
  type ConnectionServices,
} from '@on.auto/connections';

import { outboundFetch } from '../composition/outbound-fetch.ts';
import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { consentClientOf, servedClientMetadataDocumentOf } from '../composition/served-consent.ts';
import { ledgerStoresOpenedBy, type LedgerStores } from '../database/ledger-stores.ts';
import { licenseServedBy, type ServedLicense } from '../licensing/served-license.ts';
import { ownKeysOf, secretsKeptBy, type OwnKeysRead } from '../secrets/own-keys.ts';
import type { Settings } from '../settings/settings.ts';
import { accessOf, eventsReceivedAt, policyServedAt, socketsOpenedAt } from './connection-policies.ts';

interface ServedConnectionOperations {
  readonly connections: ConnectionOperations;
  readonly offering: ReturnType<typeof makeProviderOffering>;
}

type ReadOnceThrough = ConnectionServices['readOnceThrough'];

interface ThroughTheRegistry {
  readonly readOnceThrough: ReadOnceThrough;
  readonly chatModels?: ConnectionServices['chatModels'];
  readonly connectionRemoved?: ConnectionServices['connectionRemoved'];
}

export interface StoresAndConnections extends OwnKeysRead {
  readonly stores: LedgerStores;
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly connectionsReadingThrough: (registry: ThroughTheRegistry) => ServedConnectionOperations;
  readonly source: ReturnType<typeof makeConnectionSource>;
  readonly clientMetadata: RegisterRoutes;
  readonly license: ServedLicense;
  readonly studioAddress: { readonly studio: Settings['studio']; readonly runtime: () => string };
  readonly opens: ConnectionOpens;
}

type ConnectionOpens = ReturnType<typeof socketsOpenedAt>;

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
  | 'toolCalls'
  | 'receiving'
>;

interface Composed extends ThroughTheRegistry {
  readonly secrets: LedgerStores['secrets'];
  readonly consent: ReturnType<typeof consentClientOf>;
  readonly pages: ConnectionServices['pages'];
  readonly opens: ConnectionOpens;
}

function connectionServicesOf(
  settings: ServingSettings,
  { secrets, consent, pages, readOnceThrough, opens, chatModels, connectionRemoved }: Composed,
): ConnectionServices {
  return {
    consent,
    secrets,
    policy: policyServedAt(settings),
    fileEntries: settings.toolServers.servers.map(({ name }) => name),
    modelProviders: settings.modelProviders,
    providers: settings.providers,
    providerValues: settings.providerValues,
    registeredClients: settings.registeredClients,
    variables: settings.connectionVariables,
    pages,
    access: accessOf(settings),
    fetch: outboundFetch,
    readOnceThrough,
    sockets: socketChecksOver(opens),
    received: eventsReceivedAt(settings.receiving),
    ...(chatModels === undefined ? {} : { chatModels }),
    ...(connectionRemoved === undefined ? {} : { connectionRemoved }),
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
    registeredClients: settings.registeredClients,
  });
}

interface StoresOpening {
  readonly database: Parameters<typeof ledgerStoresOpenedBy>[2];
  readonly loadAws?: Parameters<typeof ledgerStoresOpenedBy>[3];
}

export async function storesAndConnectionsOf(
  runtime: Parameters<typeof licenseServedBy>[0],
  settings: Settings,
  { database, loadAws }: StoresOpening,
  ownOrigin: () => string,
): Promise<StoresAndConnections> {
  const stores = await ledgerStoresOpenedBy(runtime.context, settings, database, loadAws);
  const ownKeys = await ownKeysOf(runtime, stores.secrets, secretsKeptBy(settings));
  const consent = consentClientOf(runtime, settings, stores.secrets);
  const pages = { studio: settings.studio, runtime: ownOrigin };
  const opens = socketsOpenedAt(settings);
  return {
    stores,
    ...ownKeys,
    consent,
    opens,
    connectionsReadingThrough: (through) => {
      const services = connectionServicesOf(settings, { secrets: stores.secrets, consent, pages, opens, ...through });
      return { connections: makeConnectionOperations(services), offering: makeProviderOffering(services) };
    },
    source: sourceServedBy(runtime, settings, { secrets: stores.secrets, pages }),
    clientMetadata: clientMetadataRoutes(servedClientMetadataDocumentOf(settings, pages)),
    license: await licenseServedBy(runtime, settings.license, stores.secrets),
    studioAddress: pages,
  };
}
