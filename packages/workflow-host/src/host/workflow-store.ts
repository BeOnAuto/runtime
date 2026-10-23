import type { ConnectionPorts } from '@on.auto/ledger';

import { hostDatabaseOn, type HostDatabase } from '../database/host-database.ts';
import { hostTablesMadeOn } from '../database/host-tables.ts';
import { tablesOf, type SomeFolder } from '../projector/folder.ts';

export interface WorkflowStore {
  readonly database: HostDatabase;
}

export async function openWorkflowStore(
  connection: ConnectionPorts,
  folders: readonly SomeFolder[],
): Promise<WorkflowStore> {
  await hostTablesMadeOn(connection, tablesOf(folders));
  return { database: hostDatabaseOn(connection) };
}

export type StoreSettings = ConnectionPorts | WorkflowStore;

function isWorkflowStore(database: StoreSettings): database is WorkflowStore {
  return 'database' in database;
}

export function storeOf(database: StoreSettings, folders: readonly SomeFolder[]): Promise<WorkflowStore> {
  return isWorkflowStore(database) ? Promise.resolve(database) : openWorkflowStore(database, folders);
}
