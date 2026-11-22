import type { RouteRegistration } from '@on.auto/operations';

import { pageOperationsOf } from '../page/page-operations.ts';
import { defineListProviders } from '../providers/list-providers.ts';
import { signingOperationsOf } from '../signing/signing-operations.ts';
import { defineAddConnection } from './add-connection.ts';
import type { ConnectionServices } from './connection-services.ts';
import { settingOperationsOf } from './connection-settings.ts';
import { defineGetConnection, defineListConnections } from './read-connections.ts';
import { defineReconnectConnection } from './reconnect-connection.ts';
import { defineRemoveConnection } from './remove-connection.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

export type ConnectionOperations = readonly OrgOperation[];

export function makeConnectionOperations(services: ConnectionServices): ConnectionOperations {
  const adding = defineAddConnection(services);
  const removing = defineRemoveConnection(services);
  const page = pageOperationsOf(services);
  return [
    adding,
    defineListConnections(services, removing.registration),
    defineGetConnection(services),
    defineReconnectConnection(services),
    removing,
    ...settingOperationsOf(services),
    ...signingOperationsOf(services),
    ...page.operations,
    defineListProviders(services, { adding: adding.registration, approving: page.approving.registration }),
  ];
}
