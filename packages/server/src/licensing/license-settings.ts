import { fileSetting, type Environment, type FileSetting } from '@on.auto/config';
import { isLicenseKey } from '@on.auto/meter';
import { Config, ConfigProvider, Effect, Option, Schema } from 'effect';

import { asInvalidSettings, InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { httpOffTheLoopbackIn } from '../settings/origin.ts';
import { studioVariables } from '../studio/studio-settings.ts';

const licenseKeyVariable = 'AUTO_RUNTIME_LICENSE_KEY';

const accountsOriginVariable = 'ACCOUNTS_ORIGIN';

export const studioAndLicenseVariables: readonly string[] = [
  ...studioVariables,
  licenseKeyVariable,
  accountsOriginVariable,
];

export const defaultAccountsOrigin = 'https://accounts.on.auto';

export interface LicenseSettings {
  readonly key: string | undefined;
  readonly accounts: string;
}

const aLicenseKey = Schema.makeFilter(
  (key: string) =>
    isLicenseKey(key) ||
    'Expected the key Studio gave as it registered this installation, alk.<org>.<installation>.<secret>',
);

export const LicenseKey = Schema.String.annotate({
  description:
    'The key Studio gave as an owner of the org registered this installation, alk.<org>.<installation>.<secret>',
}).check(aLicenseKey);

const AccountsOrigin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      URL.parse(text)?.origin === text ||
      `Expected the origin of Auto's account service, such as ${defaultAccountsOrigin}`,
  ),
);

const licenseSettings = Config.all({
  key: Config.option(Config.schema(LicenseKey, licenseKeyVariable)),
  accounts: Config.schema(AccountsOrigin, accountsOriginVariable).pipe(Config.withDefault(defaultAccountsOrigin)),
});

export function readLicenseSettings(environment: Environment): LicenseSettings {
  const { key, accounts } = Effect.runSync(
    asInvalidSettings(licenseSettings.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  const refusal = httpOffTheLoopbackIn(accountsOriginVariable, accounts);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  return { key: Option.getOrUndefined(key), accounts };
}

export const licenseFileSetting: FileSetting = {
  ...fileSetting(
    licenseKeyVariable,
    Schema.Struct({
      key: Schema.String.annotate({
        description: `The key Studio gave as it registered this installation, written as a reference to the variable that holds it, such as \${LICENSE_KEY}. ${licenseKeyVariable} wins over it`,
      }).check(aLicenseKey),
    }).annotate({ description: 'The license of this runtime, after the 100 actions it runs before it is registered' }),
    ({ key }) => key,
  ),
  key: 'license',
};
