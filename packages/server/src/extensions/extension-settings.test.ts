import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { readExtensionSettings } from './extension-settings.ts';

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
  });
});
