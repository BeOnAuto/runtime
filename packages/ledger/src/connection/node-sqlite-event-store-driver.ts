import type { nodeSqliteDumboDriver, NodeSqlitePoolOptions } from '@on.auto/node-sqlite';

type NodeSqliteDumboDriver = typeof nodeSqliteDumboDriver;

export interface NodeSqliteEventStoreDriverOptions {
  readonly fileName: string;
  readonly connectionOptions?: Omit<NodeSqlitePoolOptions, 'fileName' | 'connectionString'>;
}

export type NodeSqliteEventStoreDriver = ReturnType<typeof nodeSqliteEventStoreDriverOf>;

export function nodeSqliteEventStoreDriverOf(theDumboDriver: () => NodeSqliteDumboDriver) {
  const dumboDriver = theDumboDriver();
  return {
    driverType: dumboDriver.driverType,
    dumboDriver,
    mapToDumboOptions: ({
      fileName,
      connectionOptions,
    }: NodeSqliteEventStoreDriverOptions): NodeSqlitePoolOptions & {
      readonly driver: NodeSqliteDumboDriver;
    } => ({
      driver: dumboDriver,
      fileName,
      ...connectionOptions,
      transactionOptions: { allowNestedTransactions: true, ...connectionOptions?.transactionOptions },
    }),
  };
}
