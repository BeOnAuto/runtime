import type { RouteRegistration } from '@on.auto/operations';

import { pageOperationsOf } from '../page/page-operations.ts';
import { defineListProviders } from '../providers/list-providers.ts';
import { signingOperationsOf } from '../signing/signing-operations.ts';
import { defineAddConnection } from './add-connection.ts';
import { removalOperationsOf } from './connection-removals.ts';
import type { ConnectionServices } from './connection-services.ts';
import { modelSettingOf, settingOperationsOf } from './connection-settings.ts';
import { defineGetConnection, defineListConnections } from './read-connections.ts';
import { defineReconnectConnection } from './reconnect-connection.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

export type ConnectionOperations = readonly OrgOperation[];

export function makeConnectionOperations(services: ConnectionServices): ConnectionOperations {
  const model = modelSettingOf(services);
  const reading = { ...services, chatting: model.chatting };
  const page = pageOperationsOf(reading);
  const adding = defineAddConnection(services, page.approving.registration);
  const { removing, declining } = removalOperationsOf(services);
  return [
    adding,
    defineListConnections(reading, removing.registration),
    defineGetConnection(reading),
    defineReconnectConnection(services),
    removing,
    declining,
    ...settingOperationsOf(services),
    ...model.operations,
    ...signingOperationsOf(services),
    ...page.operations,
    defineListProviders(services, { adding: adding.registration, approving: page.approving.registration }),
  ];
}
