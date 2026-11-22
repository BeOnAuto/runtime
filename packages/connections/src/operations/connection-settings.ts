import type { ConnectionServices } from './connection-services.ts';
import { defineSetConnectionAccountType } from './set-connection-account-type.ts';
import { defineSetConnectionPlaybooks } from './set-connection-playbooks.ts';

export function settingOperationsOf(services: Pick<ConnectionServices, 'secrets' | 'providers'>) {
  return [defineSetConnectionPlaybooks(services), defineSetConnectionAccountType(services)];
}
