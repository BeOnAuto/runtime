import { JSONSerializer } from '@event-driven-io/dumbo';
import { InMemorySQLiteDatabase } from '@event-driven-io/dumbo/sqlite';

import { locationOf } from '../client/node-sqlite-client.ts';
import {
  nodeSqliteConnection,
  type NodeSqliteConnectionOptions,
  type NodeSqliteDriverType,
} from '../client/node-sqlite-connection.ts';
import { connectionContext } from './connection-context.ts';
import { writerAndReadersPool } from './writer-and-readers-pool.ts';
import { writerPool, type NodeSqlitePool } from './writer-pool.ts';

export interface NodeSqlitePoolOptions extends Omit<NodeSqliteConnectionOptions, 'serializer'> {
  readonly serializer?: JSONSerializer;
  readonly driverType?: NodeSqliteDriverType;
  readonly readerPoolSize?: number;
  readonly maxTaskIdleTime?: number;
}

export function nodeSqlitePool({
  serializer = JSONSerializer,
  readerPoolSize,
  maxTaskIdleTime,
  ...given
}: NodeSqlitePoolOptions): NodeSqlitePool {
  const connectionOptions = { ...given, serializer };
  const connectionOf = (options: NodeSqliteConnectionOptions) => nodeSqliteConnection({ ...options, serializer });
  const context = connectionContext();
  return locationOf(given) === InMemorySQLiteDatabase
    ? writerPool({ getConnection: () => connectionOf(connectionOptions), context, maxTaskIdleTime })
    : writerAndReadersPool({ connectionOf, connectionOptions, context, readerPoolSize, maxTaskIdleTime });
}
