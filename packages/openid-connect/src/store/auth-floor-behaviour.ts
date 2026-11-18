import { LedgerConnection, statementOf, type ConnectionPorts, type LedgerServices } from '@on.auto/ledger';
import { Effect, ManagedRuntime, Schema, type Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SessionRow } from '../sessions/session-rows.ts';
import floor from './auth-floor.json' with { type: 'json' };
import { authLayout } from './auth-layout.ts';
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

const keptAtTheFloor: SessionRow = {
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

export function authFloorBehaviour({ name, aDatabase }: AuthFloorEntry): void {
  describe(`the sign-in's store ${name}, made at its first layout`, () => {
    it('is carried forward by every step to the structure of a new store, keeping the sessions it held', async () => {
      const [carried, made] = [await aDatabase(), await aDatabase()];
      await onTheLedger(carried, madeAtTheFloor);

      const found = await onTheLedger(carried, async (connection) => {
        const { sessionRows } = await authStoreOpened(connection);
        return [
          await connection.read(statementOf(['SELECT layout FROM auth_layout'], [])),
          await sessionRows.found(keptAtTheFloor.sha256, signedInAt),
        ];
      });
      await onTheLedger(made, authStoreOpened);

      expect([theFloor.layout, found]).toEqual([1, [[{ layout: authLayout }], keptAtTheFloor]]);
      expect(
        await carried.structure(),
        "A database of the sign-in's store made at its first layout and carried forward by every step differs from a new one: a step leaves the store as a new store of its layout would be",
      ).toEqual(await made.structure());
    });
  });
}
