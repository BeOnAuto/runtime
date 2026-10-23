import type { StoreSettings, WorkflowStore } from '../host/workflow-store.ts';
import { connectedOn } from '../testing/host-files.ts';
import type { DatabaseSettings } from './ledger-connections.ts';

export type HostedDatabase = DatabaseSettings | WorkflowStore;

export function storeSettingsOf(database: HostedDatabase): Promise<StoreSettings> {
  return 'database' in database ? Promise.resolve(database) : connectedOn(database);
}
