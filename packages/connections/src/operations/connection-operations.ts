import type { RouteRegistration } from '@on.auto/operations';

import { pageOperationsOf } from '../page/page-operations.ts';
import { defineListProviders } from '../providers/list-providers.ts';
import { signingOperationsOf } from '../signing/signing-operations.ts';
import { defineAddConnection } from './add-connection.ts';
import type { ConnectionServices } from './connection-services.ts';
import { defineGetConnection, defineListConnections } from './read-connections.ts';
import { defineReconnectConnection } from './reconnect-connection.ts';
import { defineRemoveConnection } from './remove-connection.ts';
import { defineSetConnectionPlaybooks } from './set-connection-playbooks.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

export type ConnectionOperations = readonly OrgOperation[];

export function makeConnectionOperations(services: ConnectionServices): ConnectionOperations {
  return [
    defineAddConnection(services),
    defineListConnections(services),
    defineGetConnection(services),
    defineReconnectConnection(services),
    defineRemoveConnection(services),
    defineSetConnectionPlaybooks(services),
    ...signingOperationsOf(services),
    ...pageOperationsOf(services),
    defineListProviders(services),
  ];
}
