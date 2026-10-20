import type { RetryStateKeys } from '@on.auto/api';
import type { SecretStore } from '@on.auto/secrets';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Effect, type Context } from 'effect';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logContentStore, logLedger, logSecretStore } from '../logging/logging.ts';
import type { SecretsKeySource } from '../settings/secrets-settings.ts';
import type { Settings } from '../settings/settings.ts';
import { custodiansOf, secretRowsOn, secretStoreOver } from './secret-store.ts';
import { retryStateKeysOf, secretsKeysOf, type SecretKeys } from './secrets-keys.ts';

export interface LedgerStores {
  readonly secrets: SecretStore;
  readonly retryStateKeys: RetryStateKeys;
  readonly withSecretsClosed: (served: Served) => Served;
}

function openedAndRotated(
  database: DatabaseSettings,
  keys: SecretKeys,
  keyFrom: SecretsKeySource,
): Effect.Effect<SecretStore> {
  return Effect.gen(function* () {
    const custodians = custodiansOf(keys);
    const secrets = secretStoreOver(yield* secretRowsOn(database), custodians);
    const resealed = yield* secrets.rotated();
    yield* logSecretStore({ kid: custodians.current.kid, resealed, keyFrom });
    return secrets;
  });
}

export async function ledgerStoresOpenedBy(
  context: Context.Context<never>,
  { ledger, content, secrets }: Pick<Settings, 'ledger' | 'content' | 'secrets'>,
  database: DatabaseSettings,
): Promise<LedgerStores> {
  const run = Effect.runPromiseWith(context);
  await run(Effect.andThen(logLedger(ledger), logContentStore(content)));
  const keys = secretsKeysOf(secrets);
  const store = await run(openedAndRotated(database, keys, secrets.current));
  return {
    secrets: store,
    retryStateKeys: retryStateKeysOf(keys),
    withSecretsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await store.close();
      },
    }),
  };
}
