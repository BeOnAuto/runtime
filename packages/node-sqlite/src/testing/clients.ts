import { JSONSerializer, SQL } from '@event-driven-io/dumbo';
import { onTestFinished } from 'vitest';

import { nodeSqliteClient, type NodeSqliteClient, type NodeSqliteClientOptions } from '../client/node-sqlite-client.ts';

export async function aConnectedClient(
  options: Omit<NodeSqliteClientOptions, 'serializer'>,
): Promise<NodeSqliteClient> {
  const client = nodeSqliteClient({ ...options, serializer: JSONSerializer });
  onTestFinished(() => client.close());
  await client.connect();
  return client;
}

export async function rowsOf(client: NodeSqliteClient, text: string): Promise<readonly unknown[]> {
  return (await client.query(SQL`${SQL.plain(text)}`)).rows;
}

export async function settled(answer: Promise<unknown>): Promise<PromiseSettledResult<unknown>> {
  const [outcome] = await Promise.allSettled([answer]);
  return outcome;
}
