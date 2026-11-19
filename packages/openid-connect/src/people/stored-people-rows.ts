import { statement, type Statement } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { AuthDatabase } from '../store/auth-database.ts';
import type { PeopleRows, PersonRow } from './people-rows.ts';

export const peopleTable = 'auth_people';

export const peopleTables: readonly Statement[] = [
  statement`CREATE TABLE IF NOT EXISTS auth_people (
    person TEXT NOT NULL PRIMARY KEY,
    name TEXT,
    email_address TEXT,
    joined_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
];

const WholeNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      person: Schema.String,
      name: Schema.NullOr(Schema.String),
      email_address: Schema.NullOr(Schema.String),
      joined_at: WholeNumber,
      updated_at: WholeNumber,
    }),
  ),
);

type StoredRow = ReturnType<typeof decodeRows>[number];

function rowOf({ person, name, email_address, joined_at, updated_at }: StoredRow): PersonRow {
  return {
    person,
    ...(name === null ? {} : { name }),
    ...(email_address === null ? {} : { emailAddress: email_address }),
    joinedAt: joined_at,
    updatedAt: updated_at,
  };
}

export function storedPeopleRows(database: AuthDatabase): PeopleRows {
  return {
    kept: async ({ person, name = null, emailAddress = null, updatedAt }) => {
      await database.write(statement`INSERT INTO auth_people (person, name, email_address, joined_at, updated_at)
        VALUES (${person}, ${name}, ${emailAddress}, ${updatedAt}, ${updatedAt})
        ON CONFLICT (person) DO UPDATE SET
          name = excluded.name, email_address = excluded.email_address, updated_at = excluded.updated_at`);
    },
    listed: async () =>
      decodeRows(
        await database.read(statement`SELECT person, name, email_address, joined_at, updated_at
          FROM auth_people ORDER BY joined_at, person`),
      ).map((row) => rowOf(row)),
    found: async (person) => {
      const [row] = decodeRows(
        await database.read(statement`SELECT person, name, email_address, joined_at, updated_at
          FROM auth_people WHERE person = ${person}`),
      );
      return row === undefined ? undefined : rowOf(row);
    },
    deleted: async (person) => {
      await database.write(statement`DELETE FROM auth_people WHERE person = ${person}`);
    },
  };
}
