import { AsyncLocalStorage } from 'node:async_hooks';

import type { NodeSqliteConnection } from '../client/node-sqlite-connection.ts';

export interface ConnectionContext {
  readonly active: () => NodeSqliteConnection | undefined;
  readonly inItsContext: <Result>(connection: NodeSqliteConnection, work: () => Promise<Result>) => Promise<Result>;
}

export function connectionContext(): ConnectionContext {
  const storage = new AsyncLocalStorage<{ readonly connection: NodeSqliteConnection }>();
  return {
    active: () => storage.getStore()?.connection,
    inItsContext: (connection, work) => storage.run({ connection }, work),
  };
}
