import { statement, type ConnectionPorts } from '@on.auto/ledger';

import { licenseStateSchema } from '../license-state/schema.ts';
import { clockReceiptGuards } from './clock-receipt-guards.ts';

export async function prepareMeter(connection: ConnectionPorts): Promise<void> {
  await connection.migrated([
    statement`CREATE TABLE IF NOT EXISTS meter_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cluster_id TEXT NOT NULL CHECK (length(cluster_id) > 0),
      public_key_json TEXT NOT NULL,
      secret_id TEXT NOT NULL CHECK (length(secret_id) > 0)
    )`,
    statement`CREATE TABLE IF NOT EXISTS meter_clock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision BIGINT NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
      trust_epoch BIGINT NOT NULL CHECK (trust_epoch BETWEEN 0 AND 9007199254740991),
      trust_id TEXT NOT NULL,
      server_anchor BIGINT NOT NULL CHECK (server_anchor BETWEEN 0 AND 8640000000000000),
      server_observation BIGINT NOT NULL CHECK (server_observation BETWEEN 0 AND 8640000000000000),
      wall_anchor BIGINT NOT NULL CHECK (wall_anchor BETWEEN 0 AND 8640000000000000),
      high_water BIGINT NOT NULL CHECK (high_water BETWEEN 0 AND 8640000000000000),
      wall_seen BIGINT NOT NULL CHECK (wall_seen BETWEEN 0 AND 8640000000000000),
      needs_online INTEGER NOT NULL CHECK (needs_online IN (0, 1))
    )`,
    statement`INSERT INTO meter_clock (id, revision, trust_epoch, trust_id, server_anchor, server_observation, wall_anchor, high_water, wall_seen, needs_online)
      VALUES (1, 0, 0, '', 0, 0, 0, 0, 0, 1) ON CONFLICT (id) DO NOTHING`,
    statement`CREATE TABLE IF NOT EXISTS meter_clock_refreshes (
      id TEXT PRIMARY KEY,
      trusted_at BIGINT NOT NULL CHECK (trusted_at BETWEEN 0 AND 8640000000000000)
    )`,
    ...clockReceiptGuards(connection.dialect),
    ...licenseStateSchema(connection.dialect),
    statement`CREATE TABLE IF NOT EXISTS meter_pending_license (
      id INTEGER PRIMARY KEY CHECK (id = 1), challenge_id TEXT NOT NULL UNIQUE,
      expected_revision BIGINT NOT NULL CHECK (expected_revision BETWEEN 0 AND 9007199254740991),
      challenge_payload TEXT NOT NULL
    )`,
  ]);
}
