import type { StoreSettings, WorkflowStore } from '../host/workflow-store.ts';
import { connectedOn, type LedgerOn } from '../testing/host-files.ts';

export type HostedDatabase = LedgerOn | WorkflowStore;

export function storeSettingsOf(database: HostedDatabase): Promise<StoreSettings> {
  return 'database' in database ? Promise.resolve(database) : connectedOn(database);
}
