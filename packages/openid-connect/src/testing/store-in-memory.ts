import { LedgerConnection, type ConnectionPorts } from '@on.auto/ledger';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { Effect, ManagedRuntime } from 'effect';

import { authStoreOpened, type AuthStore } from '../store/auth-store.ts';

export interface StoreInMemory {
  readonly store: AuthStore;
  readonly connection: ConnectionPorts;
  readonly close: () => Promise<void>;
}

export async function authStoreInMemory(): Promise<StoreInMemory> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName: ':memory:' }));
  const connection = await runtime.runPromise(Effect.service(LedgerConnection));
  return {
    store: await authStoreOpened(connection),
    connection,
    close: () => runtime.dispose(),
  };
}
