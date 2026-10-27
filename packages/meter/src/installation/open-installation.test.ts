import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Effect, Redacted } from 'effect';
import { exportPKCS8, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { identityBehaviour, secretIdIn } from '../testing/identity-behaviour.ts';
import { sqliteDatabase } from '../testing/sqlite-database.ts';
import { openInstallation } from './open-installation.ts';

describe('an installation identity on SQLite', () => {
  identityBehaviour(sqliteDatabase);
});

function lostAcknowledgementAndRead(connection: ConnectionPorts): ConnectionPorts {
  const state = { written: false };
  return {
    ...connection,
    write: async (sql) => {
      await connection.write(sql);
      state.written = true;
      throw new Error('acknowledgement_lost');
    },
    read: (sql) => (state.written ? Promise.reject(new Error('read_unavailable')) : connection.read(sql)),
  };
}

describe('an unavailable or damaged installation identity', () => {
  it('retains a key after the write returns but no identity can be read', async () => {
    const database = await sqliteDatabase();
    await expect(
      openInstallation({ ...database, connection: { ...database.connection, write: () => Promise.resolve([]) } }),
    ).rejects.toThrow('installation_identity_unavailable');
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });

  it('retains the committed key when the acknowledgement and subsequent read are lost', async () => {
    const database = await sqliteDatabase();
    await expect(
      openInstallation({
        ...database,
        connection: lostAcknowledgementAndRead(database.connection),
      }),
    ).rejects.toThrow('read_unavailable');
    const identity = await openInstallation(database);
    expect(identity.installationKeyDigest).toMatch(/^[a-f\d]{64}$/u);
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });

  it('does not replace malformed public-key storage with a fresh identity', async () => {
    const database = await sqliteDatabase();
    await openInstallation(database);
    await database.connection.write(statement`UPDATE meter_identity SET public_key_json = ${'{}'}`);
    await expect(openInstallation(database)).rejects.toThrow('Ed25519');
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });

  it('detects a secret reference that opens a different private key', async () => {
    const database = await sqliteDatabase();
    await openInstallation(database);
    const id = await secretIdIn(database);
    const other = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    await Effect.runPromise(database.secrets.replace(id, 1, Redacted.make(await exportPKCS8(other.privateKey))));
    await expect(openInstallation(database)).rejects.toThrow('signature verification failed');
    expect(await database.connection.read(statement`SELECT id FROM kept_secrets`)).toHaveLength(1);
  });
});
