import type { ConnectionPorts, LedgerServices } from '@on.auto/ledger';
import { LedgerConnection } from '@on.auto/ledger';
import { Ledger } from '@on.auto/operations';
import type { SecretRows, SecretStore } from '@on.auto/secrets';
import { localCustodian, sealedSecretStoreOn } from '@on.auto/secrets';
import { Effect, ManagedRuntime, Redacted, type Layer } from 'effect';
import { onTestFinished } from 'vitest';

export interface MeterDatabase {
  readonly connection: ConnectionPorts;
  readonly ledger: Ledger['Service'];
  readonly secrets: SecretStore;
  readonly reopen: () => Promise<MeterDatabase>;
  readonly close: () => Promise<void>;
}

interface Opening {
  readonly layer: Layer.Layer<LedgerServices>;
  readonly secretRows: Effect.Effect<SecretRows>;
  readonly key: Redacted.Redacted<Uint8Array>;
}

export async function openedDatabase(opening: Opening): Promise<MeterDatabase> {
  const runtime = ManagedRuntime.make(opening.layer);
  const connection = await runtime.runPromise(Effect.service(LedgerConnection));
  const ledger = await runtime.runPromise(Effect.service(Ledger));
  const secrets = sealedSecretStoreOn(await Effect.runPromise(opening.secretRows), {
    current: localCustodian(opening.key),
  });
  const state: { closed: Promise<void> | undefined } = { closed: undefined };
  const close = () => {
    state.closed ??= (async () => {
      await secrets.close();
      await runtime.dispose();
    })();
    return state.closed;
  };
  onTestFinished(close);
  return { connection, ledger, secrets, close, reopen: () => openedDatabase(opening) };
}

export function wrappingKey(): Redacted.Redacted<Uint8Array> {
  return Redacted.make(crypto.getRandomValues(new Uint8Array(32)));
}
