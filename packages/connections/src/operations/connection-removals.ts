import type { ConnectionServices } from './connection-services.ts';
import { defineDeclineConnectionRequest } from './decline-connection-request.ts';
import { defineRemoveConnection } from './remove-connection.ts';

export function removalOperationsOf(services: ConnectionServices) {
  return { removing: defineRemoveConnection(services), declining: defineDeclineConnectionRequest(services) };
}
