import {
  decodedJsonSetting,
  fileSetting,
  settingProblemText,
  type Environment,
  type FileSetting,
} from '@on.auto/config';
import type { OwnSettings } from '@on.auto/workflow-host';
import { Redacted, Result, Schema } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';

const prefixOfTheRuntime = 'AUTO_RUNTIME_';

const extensionsVariable = `${prefixOfTheRuntime}EXTENSIONS`;

const packageName = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;

const integrity = /^sha512-[A-Za-z0-9+/]{86}==$/u;

const ExtensionEntrySchema = Schema.Struct({
  package: Schema.String.check(
    Schema.isMaxLength(214),
    Schema.isPattern(packageName, { message: 'Expected the name of an installed package, such as @acme/extension' }),
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

export function settingsPrefixOf(extension: string): string {
  return `${prefixOfTheRuntime}${extension
    .replace(/^@/u, '')
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .toUpperCase()}_`;
}

const eachPackageOnce = Schema.makeFilter(
  (entries: readonly ExtensionEntry[]) =>
    new Set(entries.map((entry) => entry.package)).size === entries.length || 'Expected each package once',
);

interface Prefixed {
  readonly name: string;
  readonly prefix: string;
}

function prefixClashOf(entries: readonly ExtensionEntry[]): string | true {
  const prefixed: readonly Prefixed[] = entries.map(({ package: name }) => ({ name, prefix: settingsPrefixOf(name) }));
  const clash = prefixed
    .flatMap((one) =>
      prefixed
        .filter((other) => other.name !== one.name && other.prefix.startsWith(one.prefix))
        .map((other) => [one, other] as const),
    )
    .at(0);
  return clash === undefined
    ? true
    : `Expected packages whose settings stand under prefixes of their own: the prefix of ${clash[0].name}, ${clash[0].prefix}, begins that of ${clash[1].name}, ${clash[1].prefix}`;
}

const eachPrefixApart = Schema.makeFilter((entries: readonly ExtensionEntry[]) => prefixClashOf(entries));

const ExtensionsSchema = Schema.Array(ExtensionEntrySchema)
  .check(eachPackageOnce, eachPrefixApart)
  .annotate({
    description: `The packages the runtime loads as extensions as it starts, in order of precedence, each filling a point a capability declares and reading its own settings from the variables under its prefix, such as AUTO_RUNTIME_ACME_FORECASTS_ for @acme/forecasts; the extensions of the release stand after them. ${extensionsVariable} wins over it`,
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

export function extensionSettingsIn(
  environment: Environment,
  extensions: readonly ExtensionEntry[],
  theRuntimes: readonly string[],
): ReadonlyMap<string, Redacted.Redacted> {
  const prefixes = extensions.map(({ package: name }) => settingsPrefixOf(name));
  const ownVariables = new Set(theRuntimes);
  return new Map(
    Object.entries(environment).flatMap(([variable, value]: readonly [string, string | undefined]) =>
      value !== undefined && !ownVariables.has(variable) && prefixes.some((prefix) => variable.startsWith(prefix))
        ? [[variable, Redacted.make(value)] as const]
        : [],
    ),
  );
}

export function ownSettingsOf(
  extensionSettings: ReadonlyMap<string, Redacted.Redacted>,
  extension: string,
): OwnSettings {
  const prefix = settingsPrefixOf(extension);
  return new Map(
    [...extensionSettings].flatMap(([variable, value]: readonly [string, Redacted.Redacted]) =>
      variable.startsWith(prefix) ? [[variable.slice(prefix.length), Redacted.value(value)] as const] : [],
    ),
  );
}
