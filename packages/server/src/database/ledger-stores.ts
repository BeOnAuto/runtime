import type { SecretStore } from '@on.auto/secrets';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Effect, type Context } from 'effect';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logContentStore, logLedger, logSecretStore } from '../logging/logging.ts';
import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import type { Settings } from '../settings/settings.ts';
import { custodiansOf, secretRowsOn, secretStoreOver } from './secret-store.ts';
import { secretsKeysOf, type SecretKeys } from './secrets-keys.ts';

export interface LedgerStores {
  readonly secrets: SecretStore;
  readonly withSecretsClosed: (served: Served) => Served;
}

type SecretsSettings = Settings['secrets'];

type PreviousKeyGiven = NonNullable<SecretsSettings['previous']>;

function sealedAgainRefused({ setting }: PreviousKeyGiven, detail: string): InvalidSettingsError {
  return new InvalidSettingsError({
    message: `The secrets settings are invalid. ${setting}: The secrets its key sealed could not be sealed again under the current key: ${detail}`,
  });
}

function rotatedUnder(
  secrets: SecretStore,
  { previous }: SecretsSettings,
): Effect.Effect<number, InvalidSettingsError> {
  return previous === undefined
    ? Effect.orDie(secrets.rotated())
    : Effect.mapError(secrets.rotated(), (failure: { readonly detail: string }) =>
        sealedAgainRefused(previous, failure.detail),
      );
}

function openedAndRotated(
  database: DatabaseSettings,
  keys: SecretKeys,
  settings: SecretsSettings,
): Effect.Effect<SecretStore, InvalidSettingsError> {
  return Effect.gen(function* () {
    const custodians = custodiansOf(keys);
    const secrets = secretStoreOver(yield* secretRowsOn(database), custodians);
    const resealed = yield* rotatedUnder(secrets, settings);
    yield* logSecretStore({ kid: custodians.current.kid, resealed, keyFrom: settings.current });
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
  const store = await run(openedAndRotated(database, keys, secrets));
  return {
    secrets: store,
    withSecretsClosed: ({ routes, stopWork }) => ({
      routes,
      stopWork: async () => {
        await stopWork();
        await store.close();
      },
    }),
  };
}
