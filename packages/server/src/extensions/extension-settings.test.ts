import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { extensionSettingsIn, ownSettingsOf, readExtensionSettings, settingsPrefixOf } from './extension-settings.ts';

const integrity = `sha512-${'A'.repeat(86)}==`;

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-extensions-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

function refusalOf(written: string): () => unknown {
  return () => readExtensionSettings({ AUTO_RUNTIME_EXTENSIONS: written });
}

describe('the extensions a runtime loads', () => {
  it('are none unless set, and the packages AUTO_RUNTIME_EXTENSIONS lists as JSON, in order, each with its integrity when it names one', () => {
    const listed = [{ package: '@acme/extension' }, { package: 'other-extension', integrity }];

    expect([
      readExtensionSettings({}),
      readExtensionSettings({ AUTO_RUNTIME_EXTENSIONS: '' }),
      readExtensionSettings({ AUTO_RUNTIME_EXTENSIONS: JSON.stringify(listed) }),
    ]).toEqual([[], [], listed]);
  });

  it('are read from extensions in the configuration file, which the environment wins over', () => {
    const path = configFile('extensions:\n  - package: "@acme/extension"\n');

    expect([
      readSettingsOf({ CONFIG_FILE: path }).extensions,
      readSettingsOf({ CONFIG_FILE: path, AUTO_RUNTIME_EXTENSIONS: '[]' }).extensions,
    ]).toEqual([[{ package: '@acme/extension' }], []]);
  });

  it('stop the start with words for a package that is no name, an integrity of another form, or a package listed twice', () => {
    expect(refusalOf('[{"package":"Not A Name"}]')).toThrow(
      'The extension settings are invalid. AUTO_RUNTIME_EXTENSIONS: /0/package: Expected the name of an installed package, such as @acme/extension',
    );
    expect(refusalOf('[{"package":"@acme/extension","integrity":"sha256-abc"}]')).toThrow(
      'AUTO_RUNTIME_EXTENSIONS: /0/integrity: Expected sha512- and the base64 of 64 bytes, the integrity a refused start names',
    );
    expect(refusalOf('[{"package":"@acme/extension"},{"package":"@acme/extension"}]')).toThrow(
      'AUTO_RUNTIME_EXTENSIONS: /: Expected each package once',
    );
    expect(refusalOf('[{"package":"@acme/forecasts"},{"package":"acme-forecasts"}]')).toThrow(
      'AUTO_RUNTIME_EXTENSIONS: /: Expected packages whose settings stand under prefixes of their own: the prefix of @acme/forecasts, AUTO_RUNTIME_ACME_FORECASTS_, begins that of acme-forecasts, AUTO_RUNTIME_ACME_FORECASTS_',
    );
    expect(refusalOf('[{"package":"@acme/forecasts-eu"},{"package":"@acme/forecasts"}]')).toThrow(
      'AUTO_RUNTIME_EXTENSIONS: /: Expected packages whose settings stand under prefixes of their own: the prefix of @acme/forecasts, AUTO_RUNTIME_ACME_FORECASTS_, begins that of @acme/forecasts-eu, AUTO_RUNTIME_ACME_FORECASTS_EU_',
    );
  });
});

describe('the settings of an extension', () => {
  it('stand under AUTO_RUNTIME_ and its name in upper case, each character other than a letter or a digit read as _', () => {
    expect([settingsPrefixOf('@acme/forecasts'), settingsPrefixOf('acme.forecasts~2')]).toEqual([
      'AUTO_RUNTIME_ACME_FORECASTS_',
      'AUTO_RUNTIME_ACME_FORECASTS_2_',
    ]);
  });

  it('are the variables under the prefix of an extension listed, by the name after it, and never one the runtime reads for itself', () => {
    const { extensionSettings } = readSettingsOf({
      AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: '@acme/forecasts' }, { package: 'license' }]),
      AUTO_RUNTIME_ACME_FORECASTS_REGION: 'north',
      AUTO_RUNTIME_GLOBEX_FORECASTS_REGION: 'south',
      AUTO_RUNTIME_LICENSE_KEY: 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0',
      AUTO_RUNTIME_LICENSE_TIER: 'gold',
    });

    expect(
      [...extensionSettings].map(([variable, value]: readonly [string, Redacted.Redacted]) => [
        variable,
        Redacted.value(value),
      ]),
    ).toEqual([
      ['AUTO_RUNTIME_ACME_FORECASTS_REGION', 'north'],
      ['AUTO_RUNTIME_LICENSE_TIER', 'gold'],
    ]);
  });

  it('are handed to an extension by the names after its prefix, a variable without a value left out', () => {
    const extensionSettings = extensionSettingsIn(
      { AUTO_RUNTIME_ACME_FORECASTS_REGION: 'north', AUTO_RUNTIME_ACME_FORECASTS_FOLDER: undefined },
      [{ package: '@acme/forecasts' }],
      [],
    );

    expect([
      [...ownSettingsOf(extensionSettings, '@acme/forecasts')],
      [...ownSettingsOf(extensionSettings, '@globex/forecasts')],
    ]).toEqual([[['REGION', 'north']], []]);
  });
});

describe('the variables of the settings of an extension', () => {
  it('are variables a connection may not name, since the runtime reads them for an extension', () => {
    expect(() =>
      readSettingsOf({
        AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: '@acme/forecasts' }]),
        AUTO_RUNTIME_ACME_FORECASTS_KEY: 'forecasts-key-0123',
        CONNECTIONS: JSON.stringify({ variables: ['AUTO_RUNTIME_ACME_FORECASTS_KEY'] }),
      }),
    ).toThrow(
      'AUTO_RUNTIME_ACME_FORECASTS_KEY is a setting of the extension @acme/forecasts, which no connection may name',
    );
  });
});
