import {
  decodedJsonSetting,
  fileSetting,
  settingProblemText,
  type Environment,
  type FileSetting,
} from '@on.auto/config';
import { Result, Schema } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

const extensionsVariable = 'AUTO_RUNTIME_EXTENSIONS';

const packageName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

const integrity = /^sha512-[A-Za-z0-9+/]{86}==$/u;

const ExtensionEntrySchema = Schema.Struct({
  package: Schema.String.check(
    Schema.isMaxLength(214),
    Schema.isPattern(packageName, { message: 'Expected the name of an installed package, such as @acme/models' }),
  ).annotate({ description: 'The package of the extension, which the server imports by its name' }),
  integrity: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(integrity, {
        message: 'Expected sha512- and the base64 of 64 bytes, the integrity a refused start names',
      }),
    ).annotate({
      description:
        'The integrity of the installed package, sha512- and the base64 of the SHA-512 of its files; a package whose files differ stops the start',
    }),
  ),
});

export type ExtensionEntry = typeof ExtensionEntrySchema.Type;

const eachPackageOnce = Schema.makeFilter(
  (entries: readonly ExtensionEntry[]) =>
    new Set(entries.map((entry) => entry.package)).size === entries.length || 'Expected each package once',
);

const ExtensionsSchema = Schema.Array(ExtensionEntrySchema)
  .check(eachPackageOnce)
  .annotate({
    description: `The packages the runtime loads as extensions as it starts, in order of precedence, each filling a point a capability declares, such as prediction/model-runtime; the extensions of the release stand after them. ${extensionsVariable} wins over it`,
  });

export const extensionsFileSetting: FileSetting = {
  ...fileSetting(extensionsVariable, ExtensionsSchema, (entries) => JSON.stringify(entries)),
  key: 'extensions',
};

export const extensionVariables: readonly string[] = [extensionsVariable];

const noExtensions: readonly ExtensionEntry[] = [];

export function readExtensionSettings(environment: Environment): readonly ExtensionEntry[] {
  const written = environment[extensionsVariable];
  if (written === undefined || written === '') {
    return noExtensions;
  }
  return Result.getOrThrowWith(
    decodedJsonSetting(extensionsVariable, written, ExtensionsSchema),
    (problems) =>
      new InvalidSettingsError({
        message: `The extension settings are invalid. ${problems.map((refused) => settingProblemText(refused)).join('; ')}`,
      }),
  );
}
