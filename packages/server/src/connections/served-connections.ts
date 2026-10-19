import type { AppRuntime } from '@on.auto/api';
import {
  makeConnectionOperations,
  makeConnectionSource,
  makeProviderOffering,
  type ConnectionOperations,
  type ConnectionServices,
  type RuntimeAccess,
} from '@on.auto/connections';
import { defaultStudioOrigin, type StudioSettings } from '@on.auto/identity';
import type { SecretStore } from '@on.auto/ledger';
import type { DispatcherServices } from '@on.auto/operations';
import type { ProviderOffering } from '@on.auto/tool-servers';
import type { DatabaseSettings } from '@on.auto/workflow-host';

import { runtimeLedger } from '../composition/runtime-ledger.ts';
import { ledgerStoresOpenedBy, type LedgerStores } from '../database/ledger-stores.ts';
import type { Settings } from '../settings/settings.ts';

export interface StoresAndConnections {
  readonly stores: LedgerStores;
  readonly connections: ConnectionOperations;
  readonly source: ReturnType<typeof makeConnectionSource>;
  readonly offering: ProviderOffering;
}

const hostedStudio: StudioSettings = { origin: defaultStudioOrigin, served: false };

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
>;

function accessOf({ signIn, apiKeys }: ServingSettings): RuntimeAccess {
  if (signIn !== undefined) {
    return 'people';
  }
  return apiKeys === undefined ? 'local' : 'keys';
}

function connectionServicesOf(
  settings: ServingSettings,
  secrets: SecretStore,
  ownOrigin: () => string,
): ConnectionServices {
  const { signIn } = settings;
  return {
    secrets,
    policy: settings.connections,
    fileEntries: settings.toolServers.servers.map(({ name }) => name),
    modelProviders: settings.modelProviders,
    providers: settings.providers,
    providerValues: settings.providerValues,
    pages: { studio: hostedStudio, runtime: () => signIn?.publicUrl ?? ownOrigin() },
    access: accessOf(settings),
  };
}

function sourceServedBy(
  runtime: AppRuntime<DispatcherServices>,
  settings: ServingSettings,
  secrets: SecretStore,
): ReturnType<typeof makeConnectionSource> {
  return makeConnectionSource({
    registry: runtimeLedger(runtime),
    secrets,
    policy: settings.connections,
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
  const services = connectionServicesOf(settings, stores.secrets, ownOrigin);
  return {
    stores,
    connections: makeConnectionOperations(services),
    source: sourceServedBy(runtime, settings, stores.secrets),
    offering: makeProviderOffering(services),
  };
}
