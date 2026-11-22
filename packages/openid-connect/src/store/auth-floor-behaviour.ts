import { LedgerConnection, statement, statementOf, type ConnectionPorts, type LedgerServices } from '@on.auto/ledger';
import { Effect, ManagedRuntime, Schema, type Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { peopleOfLayoutFour } from '../people/stored-people-rows.ts';
import floor from './auth-floor.json' with { type: 'json' };
import { authLayout, authLayoutKept } from './auth-layout.ts';
import { authStoreOpened } from './auth-store.ts';

interface FloorDatabase {
  readonly ledgerOn: () => Layer.Layer<LedgerServices>;
  readonly structure: () => Promise<unknown>;
}

export interface AuthFloorEntry {
  readonly name: string;
  readonly aDatabase: () => Promise<FloorDatabase>;
}

const theFloor = Schema.decodeUnknownSync(Schema.Struct({ layout: Schema.Number, made: Schema.Array(Schema.String) }))(
  floor,
);

const signedInAt = Date.parse('2026-11-18T09:00:00Z');

const keptAtTheFloor = {
  sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
  issuer: 'https://login.example.com/tenant/v2.0',
  subject: 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4',
  createdAt: signedInAt,
  lastUsedAt: signedInAt,
  expiresAt: signedInAt + 7 * 86_400_000,
};

const sessionKeptAtTheFloor = statementOf(
  [
    'INSERT INTO auth_sessions (sha256, issuer, subject, created_at, last_used_at, expires_at) VALUES (',
    ', ',
    ', ',
    ', ',
    ', ',
    ', ',
    ')',
  ],
  [
    keptAtTheFloor.sha256,
    keptAtTheFloor.issuer,
    keptAtTheFloor.subject,
    keptAtTheFloor.createdAt,
    keptAtTheFloor.lastUsedAt,
    keptAtTheFloor.expiresAt,
  ],
);

async function onTheLedger<A>(database: FloorDatabase, use: (connection: ConnectionPorts) => Promise<A>): Promise<A> {
  const runtime = ManagedRuntime.make(database.ledgerOn());
  try {
    return await use(await runtime.runPromise(Effect.service(LedgerConnection)));
  } finally {
    await runtime.dispose();
  }
}

async function madeAtTheFloor(connection: ConnectionPorts): Promise<void> {
  await theFloor.made.reduce(async (before: Promise<unknown>, made) => {
    await before;
    return connection.write(statementOf([made], []));
  }, Promise.resolve());
  await connection.write(sessionKeptAtTheFloor);
}

const aPerson = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

const layoutRead = statementOf(['SELECT layout FROM auth_layout'], []);

async function keptAtLayoutFour(connection: ConnectionPorts): Promise<void> {
  await authLayoutKept(connection, { kept: 4, steps: [], tables: [] });
  await connection.write(peopleOfLayoutFour);
  await connection.write(statement`INSERT INTO auth_people (person, name, email_address, joined_at, updated_at)
    VALUES (${aPerson}, ${'Ada Lovelace'}, ${'ada@example.com'}, ${signedInAt}, ${signedInAt})`);
}

function addressesVerifiedBehaviour({ name, aDatabase }: AuthFloorEntry): void {
  describe(`the sign-in's store ${name}, made at layout 4`, () => {
    it('carries a person to layout 5 with their name and address, the address not known to be verified', async () => {
      const found = await onTheLedger(await aDatabase(), async (connection) => {
        await keptAtLayoutFour(connection);
        const { peopleRows } = await authStoreOpened(connection);
        return [await connection.read(layoutRead), await peopleRows.found(aPerson)];
      });

      expect(found).toEqual([
        [{ layout: authLayout }],
        {
          person: aPerson,
          name: 'Ada Lovelace',
          emailAddress: 'ada@example.com',
          joinedAt: signedInAt,
          updatedAt: signedInAt,
        },
      ]);
    });
  });
}

function floorBehaviour({ name, aDatabase }: AuthFloorEntry): void {
  describe(`the sign-in's store ${name}, made at its first layout`, () => {
    it('is carried forward by every step to the structure of a new store, its sessions of the first layout dropped', async () => {
      const [carried, made] = [await aDatabase(), await aDatabase()];
      await onTheLedger(carried, madeAtTheFloor);

      const found = await onTheLedger(carried, async (connection) => {
        await authStoreOpened(connection);
        return connection.read(layoutRead);
      });
      await onTheLedger(made, authStoreOpened);

      expect([theFloor.layout, found]).toEqual([1, [{ layout: authLayout }]]);
      expect(
        await carried.structure(),
        "A database of the sign-in's store made at its first layout and carried forward by every step differs from a new one: a step leaves the store as a new store of its layout would be",
      ).toEqual(await made.structure());
    });
  });
}

export function authFloorBehaviour(entry: AuthFloorEntry): void {
  floorBehaviour(entry);
  addressesVerifiedBehaviour(entry);
}
