import { nodeSqliteDumboDriver, type NodeSqlitePoolOptions } from '@on.auto/node-sqlite';

import { statementStarted } from '../store-reads/store-reads.ts';

type NodeSqliteDumboDriver = typeof nodeSqliteDumboDriver;

interface NodeSqliteEventStoreDriverOptions {
  readonly fileName: string;
  readonly connectionOptions?: Omit<NodeSqlitePoolOptions, 'fileName' | 'connectionString'>;
}

export const nodeSqliteEventStoreDriver = {
  driverType: nodeSqliteDumboDriver.driverType,
  dumboDriver: nodeSqliteDumboDriver,
  mapToDumboOptions: ({
    fileName,
    connectionOptions,
  }: NodeSqliteEventStoreDriverOptions): NodeSqlitePoolOptions & { readonly driver: NodeSqliteDumboDriver } => ({
    driver: nodeSqliteDumboDriver,
    fileName,
    statementStarted,
    ...connectionOptions,
    transactionOptions: { allowNestedTransactions: true, ...connectionOptions?.transactionOptions },
  }),
};
