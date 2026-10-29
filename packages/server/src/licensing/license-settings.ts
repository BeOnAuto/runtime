import { fileSetting, type Environment, type FileSetting } from '@on.auto/config';
import { isLicenseKey, SignedSchema, type KeyInHand, type Signed } from '@on.auto/meter';
import { Config, ConfigProvider, Effect, Option, Schema } from 'effect';

import { asInvalidSettings, InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { httpOffTheLoopbackIn } from '../settings/origin.ts';
import { studioVariables } from '../studio/studio-settings.ts';

const licenseKeyVariable = 'AUTO_RUNTIME_LICENSE_KEY';

const allocationVariable = 'AUTO_RUNTIME_ALLOCATION';

const licenseVariable = 'AUTO_RUNTIME_LICENSE';

const accountsOriginVariable = 'ACCOUNTS_ORIGIN';

export const studioAndLicenseVariables: readonly string[] = [
  ...studioVariables,
  licenseKeyVariable,
  allocationVariable,
  licenseVariable,
  accountsOriginVariable,
];

export const defaultAccountsOrigin = 'https://billing.on.auto';

export interface LicenseSettings {
  readonly key: KeyInHand | undefined;
  readonly allocation: Signed | undefined;
  readonly accounts: string;
}

const signedIn = Schema.decodeUnknownOption(Schema.fromJsonString(SignedSchema));

const aLicenseKey = Schema.makeFilter(
  (key: string) =>
    isLicenseKey(key) ||
    'Expected the key Studio gave as an owner registered this runtime, alk.<org>.<runtime id>.<secret>',
);

export const LicenseKey = Schema.String.annotate({
  description: 'The key Studio gave as an owner of the org registered this runtime, alk.<org>.<runtime id>.<secret>',
}).check(aLicenseKey);

const anAllocation = Schema.makeFilter(
  (text: string) =>
    Option.isSome(signedIn(text)) ||
    'Expected the offline credits an operator of Auto signed for this runtime, as the JSON of their payload, signature and kid',
);

const AllocationText = Schema.String.check(anAllocation);

const LicenseInFile = Schema.Struct({
  key: Schema.optionalKey(
    Schema.String.annotate({
      description: `The key Studio gave as an owner registered this runtime, written as a reference to the variable that holds it, such as \${LICENSE_KEY}. ${licenseKeyVariable} wins over it`,
    }).check(aLicenseKey),
  ),
  allocation: Schema.optionalKey(
    Schema.String.annotate({
      description: `The offline credits an operator of Auto signed for a runtime that does not reach Auto, the JSON of their payload, signature and kid, written as a reference to the variable that holds it, such as \${ALLOCATION}. ${allocationVariable} wins over it`,
    }).check(anAllocation),
  ),
}).annotate({
  description: `The license of this runtime, which runs it on its org's credits past the 100 free runs and the free rate of 15 runs a UTC day and 75 a UTC month it runs without one: its key, and the offline credits of a runtime that does not reach Auto. ${licenseVariable} wins over it`,
});

const AccountsOrigin = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      URL.parse(text)?.origin === text ||
      `Expected the origin of Auto's account service, such as ${defaultAccountsOrigin}`,
  ),
);

const licenseSettings = Config.all({
  key: Config.option(Config.schema(LicenseKey, licenseKeyVariable)),
  allocation: Config.option(Config.schema(AllocationText, allocationVariable)),
  inFile: Config.option(Config.schema(Schema.fromJsonString(LicenseInFile), licenseVariable)),
  accounts: Config.schema(AccountsOrigin, accountsOriginVariable).pipe(Config.withDefault(defaultAccountsOrigin)),
});

const noLicenseInFile: typeof LicenseInFile.Type = {};

export function readLicenseSettings(environment: Environment): LicenseSettings {
  const { key, allocation, inFile, accounts } = Effect.runSync(
    asInvalidSettings(licenseSettings.parse(ConfigProvider.fromEnvRecord(environment))),
  );
  const refusal = httpOffTheLoopbackIn(accountsOriginVariable, accounts);
  if (refusal !== undefined) {
    throw new InvalidSettingsError({ message: refusal });
  }
  const file = Option.getOrElse(inFile, () => noLicenseInFile);
  const allocationText = Option.orElse(allocation, () => Option.fromNullishOr(file.allocation));
  const fromEnvironment = Option.map(key, (given): KeyInHand => ({ key: given, source: 'environment' }));
  const fromFile = Option.map(Option.fromNullishOr(file.key), (given): KeyInHand => ({
    key: given,
    source: 'configuration',
  }));
  return {
    key: Option.getOrUndefined(Option.orElse(fromEnvironment, () => fromFile)),
    allocation: Option.getOrUndefined(Option.flatMap(allocationText, signedIn)),
    accounts,
  };
}

export const licenseFileSetting: FileSetting = {
  ...fileSetting(licenseVariable, LicenseInFile, (license) => JSON.stringify(license)),
  key: 'license',
};
