import { connectionsFold, connectionsStreamOfOrg } from '@on.auto/connections/testing';
import { ledgerLayer, sqliteSecretRows } from '@on.auto/ledger/sqlite3';
import { Ledger } from '@on.auto/operations';
import { localCustodian, sealedSecretStoreOn, type SecretStore } from '@on.auto/secrets';
import { Effect, ManagedRuntime, Redacted } from 'effect';

import { ownKeysDecider, ownKeysStream, type OwnKeyEvent } from '../../secrets/own-keys.ts';

export const secretsKey = Buffer.alloc(32, 7);

export async function secretStoreInFile(fileName: string, key: Readonly<Uint8Array>): Promise<SecretStore> {
  return sealedSecretStoreOn(await Effect.runPromise(sqliteSecretRows({ fileName })), {
    current: localCustodian(Redacted.make(Uint8Array.from(key))),
  });
}

export async function secretIdOf(fileName: string, org: string, connection: string): Promise<string | undefined> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  const { state } = await runtime.runPromise(
    Effect.flatMap(Ledger, (ledger) => ledger.load(connectionsStreamOfOrg(org), connectionsFold)),
  );
  await runtime.dispose();
  return state.get(connection)?.secretId;
}

export async function ownKeyFactsIn(fileName: string): Promise<readonly OwnKeyEvent[]> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  const collecting = {
    ...ownKeysDecider,
    initialState: [],
    evolve: (facts: readonly OwnKeyEvent[], fact: OwnKeyEvent) => [...facts, fact],
  };
  const { state } = await runtime.runPromise(
    Effect.flatMap(Ledger, (ledger) => ledger.load(ownKeysStream, collecting)),
  );
  await runtime.dispose();
  return state;
}

export interface KeptSecret {
  readonly value: string | undefined;
  readonly endsWith: string | undefined;
}

export async function keptSecretOf(fileName: string, id: string): Promise<KeptSecret> {
  const store = await secretStoreInFile(fileName, secretsKey);
  const stored = await Effect.runPromise(store.read(id));
  const endings = await Effect.runPromise(store.endingsOf([id]));
  await store.close();
  return { value: stored === undefined ? undefined : Redacted.value(stored.value), endsWith: endings.get(id) };
}
