import { statement, type ConnectionPorts } from '@on.auto/ledger';

export async function prepareMeter(connection: ConnectionPorts): Promise<void> {
  await connection.migrated([
    statement`CREATE TABLE IF NOT EXISTS meter_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cluster_id TEXT NOT NULL CHECK (length(cluster_id) > 0),
      public_key_json TEXT NOT NULL,
      secret_id TEXT NOT NULL CHECK (length(secret_id) > 0)
    )`,
  ]);
}
