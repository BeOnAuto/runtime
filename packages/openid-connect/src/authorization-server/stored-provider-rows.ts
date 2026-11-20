import { statement, statementOf, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { AuthDatabase } from '../store/auth-database.ts';
import type { ModelRowKey, ProviderRows, StoredPayload } from './provider-rows.ts';

export const providerModelsTable = 'auth_oidc_models';

export const providerModelTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS auth_oidc_models (
    model TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    payload TEXT NOT NULL,
    grant_id TEXT,
    uid TEXT,
    consumed_at BIGINT,
    expires_at BIGINT,
    PRIMARY KEY (model, sha256)
  )`,
  statement`CREATE INDEX IF NOT EXISTS auth_oidc_models_grant_id ON auth_oidc_models (grant_id)`,
  statement`CREATE INDEX IF NOT EXISTS auth_oidc_models_uid ON auth_oidc_models (uid)`,
  statement`CREATE INDEX IF NOT EXISTS auth_oidc_models_expires_at ON auth_oidc_models (expires_at)`,
];

const WholeNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

const decodeListedRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ sha256: Schema.String, payload: Schema.String })),
);

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      payload: Schema.String,
      grant_id: Schema.NullOr(Schema.String),
      consumed_at: Schema.NullOr(WholeNumber),
    }),
  ),
);

function firstOf(rows: readonly unknown[]): StoredPayload | undefined {
  const [row] = decodeRows(rows);
  return row === undefined
    ? undefined
    : {
        payload: row.payload,
        grantId: row.grant_id ?? undefined,
        consumedAt: row.consumed_at ?? undefined,
      };
}

export function storedProviderRows(database: AuthDatabase): ProviderRows {
  return {
    kept: async ({ model, sha256, payload, grantId = null, uid = null, expiresAt = null }) => {
      await database.write(statement`INSERT INTO auth_oidc_models
        (model, sha256, payload, grant_id, uid, consumed_at, expires_at)
        VALUES (${model}, ${sha256}, ${payload}, ${grantId}, ${uid}, NULL, ${expiresAt})
        ON CONFLICT (model, sha256) DO UPDATE SET
          payload = excluded.payload, grant_id = excluded.grant_id, uid = excluded.uid, expires_at = excluded.expires_at`);
    },
    found: async ({ model, sha256 }: ModelRowKey) =>
      firstOf(
        await database.read(statement`SELECT payload, grant_id, consumed_at FROM auth_oidc_models
          WHERE model = ${model} AND sha256 = ${sha256}`),
      ),
    listed: async (model) =>
      decodeListedRows(
        await database.read(statement`SELECT sha256, payload FROM auth_oidc_models WHERE model = ${model}`),
      ),
    foundByUid: async (model, uid) =>
      firstOf(
        await database.read(statement`SELECT payload, grant_id, consumed_at FROM auth_oidc_models
          WHERE model = ${model} AND uid = ${uid}`),
      ),
    consumed: async ({ model, sha256 }, at) => {
      const marked = await database.write(statement`UPDATE auth_oidc_models SET consumed_at = ${at}
        WHERE model = ${model} AND sha256 = ${sha256} AND consumed_at IS NULL RETURNING sha256`);
      return marked.length === 1;
    },
    destroyed: async ({ model, sha256 }) => {
      await database.write(statement`DELETE FROM auth_oidc_models WHERE model = ${model} AND sha256 = ${sha256}`);
    },
    revokedByGrant: async (model, grantId) => {
      await database.write(statement`DELETE FROM auth_oidc_models WHERE model = ${model} AND grant_id = ${grantId}`);
    },
    endedEvery: async (models) => {
      const parts = models.map((_, at) => (at === 0 ? 'DELETE FROM auth_oidc_models WHERE model IN (' : ', '));
      await database.write(statementOf([...parts, ')'], models));
    },
    swept: async (endedBefore) => {
      await database.write(statement`DELETE FROM auth_oidc_models WHERE expires_at <= ${endedBefore}`);
    },
  };
}
