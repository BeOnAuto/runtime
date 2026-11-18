import { LedgerConnection, statement, type ConnectionPorts, type Dialect, type LedgerServices } from '@on.auto/ledger';
import { Effect, ManagedRuntime, Schema, type Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { peopleRowsBehaviour } from '../people/people-rows-behaviour.ts';
import type { SessionRow } from '../sessions/session-rows.ts';
import { sessionRowsBehaviour } from '../testing/session-rows-behaviour.ts';
import { authLayout, authLayoutKept, authTablePrefix, type AuthLayoutStep } from './auth-layout.ts';
import { authStoreOpened } from './auth-store.ts';

export interface AuthStoreEntry {
  readonly name: string;
  readonly aDatabase: () => Promise<() => Layer.Layer<LedgerServices>>;
}

const relationsOfTheSchema: Readonly<Record<Dialect, ReturnType<typeof statement>>> = {
  sqlite: statement`SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT GLOB 'sqlite_*'`,
  postgresql: statement`SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()
    UNION SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()`,
};

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

async function relationsIn(connection: ConnectionPorts): Promise<readonly string[]> {
  return decodeNames(await connection.read(relationsOfTheSchema[connection.dialect]))
    .map(({ name }) => name)
    .toSorted();
}

const layoutRead = statement`SELECT layout FROM auth_layout`;

interface Connected {
  readonly connection: ConnectionPorts;
  readonly closed: () => Promise<void>;
}

async function connectedTo(layer: Layer.Layer<LedgerServices>): Promise<Connected> {
  const runtime = ManagedRuntime.make(layer);
  onTestFinished(() => runtime.dispose());
  return { connection: await runtime.runPromise(Effect.service(LedgerConnection)), closed: () => runtime.dispose() };
}

function aConnectionOf({ aDatabase }: AuthStoreEntry): () => Promise<ConnectionPorts> {
  return async () => (await connectedTo((await aDatabase())())).connection;
}

const noTables: readonly string[] = [];

function carried(kept: number, steps: readonly AuthLayoutStep[] = []) {
  return { kept, steps, tables: noTables };
}

const notesMade: AuthLayoutStep = {
  layout: 2,
  statements: [statement`CREATE TABLE IF NOT EXISTS auth_notes (id TEXT NOT NULL PRIMARY KEY)`],
};

const notesIndexed: AuthLayoutStep = {
  layout: 3,
  statements: [statement`CREATE INDEX IF NOT EXISTS auth_notes_by_id ON auth_notes (id)`],
};

const aStepThatFails: AuthLayoutStep = {
  layout: 3,
  statements: [statement`CREATE INDEX auth_notes_by_id ON auth_notes_never_made (id)`],
};

const refusedAs = (found: number) => ({ _tag: 'auth_layout_refused', found, kept: authLayout });

const refusedWithNoNumber = { _tag: 'auth_layout_refused', found: undefined, kept: authLayout };

const signedInAt = Date.parse('2026-11-18T09:00:00Z');

const aSession: SessionRow = {
  sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
  issuer: 'https://login.example.com/tenant/v2.0',
  subject: 'AItOawmwtWwcT0k51BayewNvutrJUqsvl6qs7A4',
  createdAt: signedInAt,
  lastUsedAt: signedInAt,
  expiresAt: signedInAt + 7 * 86_400_000,
};

function openingBehaviour(entry: AuthStoreEntry): void {
  const aConnection = aConnectionOf(entry);

  describe(`the sign-in's store ${entry.name}, as it opens`, () => {
    it('lays its layout on a database the ledger made before it, and every table and index it makes begins with its prefix', async () => {
      const connection = await aConnection();
      const before = await relationsIn(connection);

      await authStoreOpened(connection);

      const made = (await relationsIn(connection)).filter((relation) => !before.includes(relation));
      expect(await connection.read(layoutRead)).toEqual([{ layout: authLayout }]);
      expect(made).not.toEqual([]);
      expect(made.filter((relation) => !relation.startsWith(authTablePrefix))).toEqual([]);
    });

    it('opens a database in its layout again, as a server that restarts, keeping its sessions and changing nothing', async () => {
      const ledgerOn = await entry.aDatabase();
      const first = await connectedTo(ledgerOn());
      await (await authStoreOpened(first.connection)).sessionRows.kept(aSession);
      const before = await relationsIn(first.connection);
      await first.closed();

      const { connection: again } = await connectedTo(ledgerOn());
      const { sessionRows } = await authStoreOpened(again);

      expect([await relationsIn(again), await again.read(layoutRead)]).toEqual([before, [{ layout: authLayout }]]);
      expect(await sessionRows.found(aSession.sha256, aSession.createdAt)).toEqual(aSession);
    });

    it('lays its layout once when it is opened twice at once on a new database', async () => {
      const connection = await aConnection();

      await Promise.all([authStoreOpened(connection), authStoreOpened(connection)]);

      expect(await connection.read(layoutRead)).toEqual([{ layout: authLayout }]);
    });

    it('makes the tables it lacks in its layout, as when its first opening ended after it laid the layout', async () => {
      const connection = await aConnection();
      await authStoreOpened(connection);
      const made = await relationsIn(connection);
      await connection.write(statement`DROP TABLE auth_sessions`);

      await authStoreOpened(connection);

      expect(await relationsIn(connection)).toEqual(made);
    });
  });
}

function carryingBehaviour(entry: AuthStoreEntry): void {
  const aConnection = aConnectionOf(entry);

  describe(`the sign-in's store ${entry.name}, carried forward`, () => {
    it('takes each step from the layout found to the one kept, in order, writing the number last', async () => {
      const connection = await aConnection();
      await authLayoutKept(connection, carried(1));

      await authLayoutKept(connection, carried(3, [notesIndexed, notesMade]));

      expect(await connection.read(layoutRead)).toEqual([{ layout: 3 }]);
      expect(await relationsIn(connection)).toEqual(expect.arrayContaining(['auth_notes', 'auth_notes_by_id']));
    });

    it('takes each step once when it is carried twice at once', async () => {
      const connection = await aConnection();
      await authLayoutKept(connection, carried(1));

      await Promise.all([
        authLayoutKept(connection, carried(3, [notesMade, notesIndexed])),
        authLayoutKept(connection, carried(3, [notesMade, notesIndexed])),
      ]);

      expect(await connection.read(layoutRead)).toEqual([{ layout: 3 }]);
    });

    it('stays at the layout before a step that fails, and takes it at the next opening', async () => {
      const connection = await aConnection();
      await authLayoutKept(connection, carried(1));

      await expect(authLayoutKept(connection, carried(3, [notesMade, aStepThatFails]))).rejects.toBeInstanceOf(Error);
      const stayed = await connection.read(layoutRead);
      await authLayoutKept(connection, carried(3, [notesMade, notesIndexed]));

      expect([stayed, await connection.read(layoutRead)]).toEqual([[{ layout: 2 }], [{ layout: 3 }]]);
    });

    it('takes no step when it is given none to a layout between the one found and the one kept', async () => {
      const connection = await aConnection();
      await authLayoutKept(connection, carried(1));

      await expect(authLayoutKept(connection, carried(3, [notesMade]))).rejects.toBeInstanceOf(Error);
      expect(await connection.read(layoutRead)).toEqual([{ layout: 1 }]);
    });
  });
}

function refusingBehaviour(entry: AuthStoreEntry): void {
  const aConnection = aConnectionOf(entry);

  describe(`the sign-in's store ${entry.name}, refused`, () => {
    it('refuses a database a newer release carried forward, and leaves it as it was', async () => {
      const connection = await aConnection();
      await authStoreOpened(connection);
      await connection.write(statement`UPDATE auth_layout SET layout = ${authLayout + 1}`);
      const before = await relationsIn(connection);

      await expect(authStoreOpened(connection)).rejects.toMatchObject(refusedAs(authLayout + 1));
      expect([await relationsIn(connection), await connection.read(layoutRead)]).toEqual([
        before,
        [{ layout: authLayout + 1 }],
      ]);
    });

    it('refuses a database that holds its tables with no layout number, and makes nothing', async () => {
      const connection = await aConnection();
      await authStoreOpened(connection);
      await connection.write(statement`DROP TABLE auth_layout`);

      await expect(authStoreOpened(connection)).rejects.toMatchObject(refusedWithNoNumber);
      expect(await relationsIn(connection)).not.toContain('auth_layout');
    });

    it('refuses a layout before its first', async () => {
      const connection = await aConnection();
      await authStoreOpened(connection);
      await connection.write(statement`UPDATE auth_layout SET layout = 0`);

      await expect(authStoreOpened(connection)).rejects.toMatchObject(refusedAs(0));
    });
  });
}

const rolledBack = new Error('The transaction of the ledger is rolled back');

export function sessionsEndedBehaviour(entry: AuthStoreEntry): void {
  const aConnection = aConnectionOf(entry);

  describe(`a session in the sign-in's store ${entry.name}, ended while a transaction of the ledger is open`, () => {
    it('stays ended once that transaction is rolled back, when it is ended from outside it', async () => {
      const connection = await aConnection();
      const { sessionRows } = await authStoreOpened(connection);
      await sessionRows.kept(aSession);
      const begun = Promise.withResolvers<void>();
      const letGo = Promise.withResolvers<void>();
      const transaction = connection.readConsistently(async () => {
        begun.resolve();
        await letGo.promise;
        throw rolledBack;
      });

      await begun.promise;
      const ending = sessionRows.ended(aSession.sha256);
      letGo.resolve();

      await expect(transaction).rejects.toBe(rolledBack);
      await ending;
      expect(await sessionRows.found(aSession.sha256, aSession.createdAt)).toBeUndefined();
    });

    it('stays ended once that transaction is rolled back, when it is ended by code running inside it', async () => {
      const connection = await aConnection();
      const { sessionRows } = await authStoreOpened(connection);
      await sessionRows.kept(aSession);
      const ending: { promise?: Promise<void> } = {};

      const transaction = connection.readConsistently(async (read) => {
        ending.promise = sessionRows.ended(aSession.sha256);
        await read(statement`SELECT count(*) AS sessions FROM auth_sessions`);
        throw rolledBack;
      });

      await expect(transaction).rejects.toBe(rolledBack);
      await ending.promise;
      expect(await sessionRows.found(aSession.sha256, aSession.createdAt)).toBeUndefined();
    });
  });
}

export function authStoreBehaviour(entry: AuthStoreEntry): void {
  openingBehaviour(entry);
  carryingBehaviour(entry);
  refusingBehaviour(entry);
  sessionRowsBehaviour({
    name: `in the sign-in's store ${entry.name}`,
    rowsOf: async () => (await authStoreOpened(await aConnectionOf(entry)())).sessionRows,
  });
  peopleRowsBehaviour({
    name: `in the sign-in's store ${entry.name}`,
    rowsOf: async () => (await authStoreOpened(await aConnectionOf(entry)())).peopleRows,
  });
  sessionsEndedBehaviour(entry);
}
