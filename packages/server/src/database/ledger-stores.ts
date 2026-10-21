import {
  custodianProbed,
  sealedSecretStoreOn,
  type Custodian,
  type Custodians,
  type SecretStore,
} from '@on.auto/secrets';
import type { DatabaseSettings } from '@on.auto/workflow-host';
import { Effect, type Context } from 'effect';

import type { Served } from '../lifecycle/lifecycle.ts';
import { logContentStore, logLedger, logSecretStore } from '../logging/logging.ts';
import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import type { Settings } from '../settings/settings.ts';
import { loadKmsCustodians, type KmsCustodiansLoader } from './kms-custodians.ts';
import { custodiansOf, secretRowsOn } from './secret-store.ts';

export interface LedgerStores {
  readonly secrets: SecretStore;
  readonly withSecretsClosed: (served: Served) => Served;
}

type SecretsSettings = Settings['secrets'];

type PreviousKeyGiven = NonNullable<SecretsSettings['previous']>;

function invalid(setting: string, detail: string): InvalidSettingsError {
  return new InvalidSettingsError({ message: `The secrets settings are invalid. ${setting}: ${detail}` });
}

function sealedAgainRefused({ setting }: PreviousKeyGiven, detail: string): InvalidSettingsError {
  return invalid(setting, `The secrets its key sealed could not be sealed again under the current key: ${detail}`);
}

function probedAtStart(custodian: Custodian, { current }: SecretsSettings): Effect.Effect<void, InvalidSettingsError> {
  return current.from === 'kms'
    ? Effect.mapError(custodianProbed(custodian), ({ detail }: { readonly detail: string }) =>
        invalid(
          current.setting,
          `The KMS key ${custodian.kid} it names could not wrap and unwrap a data key at start: ${detail}`,
        ),
      )
    : Effect.void;
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
  custodians: Custodians,
  settings: SecretsSettings,
): Effect.Effect<SecretStore, InvalidSettingsError> {
  return Effect.gen(function* () {
    yield* probedAtStart(custodians.current, settings);
    const secrets = sealedSecretStoreOn(yield* secretRowsOn(database), custodians);
    const resealed = yield* rotatedUnder(secrets, settings);
    yield* logSecretStore({ kid: custodians.current.kid, resealed, keyFrom: settings.current });
    return secrets;
  });
}

export async function ledgerStoresOpenedBy(
  context: Context.Context<never>,
  { ledger, content, secrets, proxy }: Pick<Settings, 'ledger' | 'content' | 'secrets' | 'proxy'>,
  database: DatabaseSettings,
  loadKms: KmsCustodiansLoader = loadKmsCustodians,
): Promise<LedgerStores> {
  const run = Effect.runPromiseWith(context);
  await run(Effect.andThen(logLedger(ledger), logContentStore(content)));
  const custodians = await custodiansOf(secrets, { proxy, loadKms });
  const store = await run(openedAndRotated(database, custodians, secrets));
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
