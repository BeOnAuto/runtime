import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { AuthDatabase } from '../store/auth-database.ts';
import type { SessionRow, SessionRows } from './session-rows.ts';

export const sessionsTable = 'auth_sessions';

export const sessionTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS auth_sessions (
    sha256 TEXT NOT NULL PRIMARY KEY,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    last_used_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  statement`CREATE INDEX IF NOT EXISTS auth_sessions_expires_at ON auth_sessions (expires_at)`,
];

const WholeNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      sha256: Schema.String,
      issuer: Schema.String,
      subject: Schema.String,
      created_at: WholeNumber,
      last_used_at: WholeNumber,
      expires_at: WholeNumber,
    }),
  ),
);

async function rowFound(database: AuthDatabase, sha256: string, now: number): Promise<SessionRow | undefined> {
  const [row] = decodeRows(
    await database.read(statement`SELECT sha256, issuer, subject, created_at, last_used_at, expires_at
      FROM auth_sessions WHERE sha256 = ${sha256} AND expires_at > ${now}`),
  );
  return row === undefined
    ? undefined
    : {
        sha256: row.sha256,
        issuer: row.issuer,
        subject: row.subject,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
      };
}

export function storedSessionRows(database: AuthDatabase): SessionRows {
  return {
    kept: async ({ sha256, issuer, subject, createdAt, lastUsedAt, expiresAt }) => {
      await database.write(statement`DELETE FROM auth_sessions WHERE expires_at <= ${createdAt}`);
      await database.write(statement`INSERT INTO auth_sessions
        (sha256, issuer, subject, created_at, last_used_at, expires_at)
        VALUES (${sha256}, ${issuer}, ${subject}, ${createdAt}, ${lastUsedAt}, ${expiresAt})`);
    },
    found: (sha256, now) => rowFound(database, sha256, now),
    used: async ({ sha256, lastUsedAt, expiresAt }) => {
      await database.write(
        statement`UPDATE auth_sessions SET last_used_at = ${lastUsedAt}, expires_at = ${expiresAt} WHERE sha256 = ${sha256}`,
      );
    },
    ended: async (sha256) => {
      await database.write(statement`DELETE FROM auth_sessions WHERE sha256 = ${sha256}`);
    },
  };
}
