import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { AuthDatabase } from '../store/auth-database.ts';

export const signingKeyTable = 'auth_signing_key';

export const signingKeyTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS auth_signing_key (
    one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row),
    secret_id TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
];

export interface SigningKeyRows {
  readonly kept: (secretId: string, at: number) => Promise<boolean>;
  readonly replaced: (secretId: string, at: number, lost: string) => Promise<boolean>;
  readonly found: () => Promise<string | undefined>;
}

const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ secret_id: Schema.String })));

export function storedSigningKeyRows(database: AuthDatabase): SigningKeyRows {
  return {
    kept: async (secretId, at) => {
      const written = await database.write(statement`INSERT INTO auth_signing_key (secret_id, created_at)
        VALUES (${secretId}, ${at}) ON CONFLICT (one_row) DO NOTHING RETURNING secret_id`);
      return written.length === 1;
    },
    replaced: async (secretId, at, lost) => {
      const written =
        await database.write(statement`UPDATE auth_signing_key SET secret_id = ${secretId}, created_at = ${at}
        WHERE secret_id = ${lost} RETURNING secret_id`);
      return written.length === 1;
    },
    found: async () => {
      const [row] = decodeRows(await database.read(statement`SELECT secret_id FROM auth_signing_key`));
      return row?.secret_id;
    },
  };
}
