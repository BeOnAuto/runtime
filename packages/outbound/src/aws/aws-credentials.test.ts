import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { awsCredentialChainOf } from '../index.ts';

const theMainEntry = new URL('../index.ts', import.meta.url);

const credentialProviders = '@aws-sdk/credential-providers';

const loadedWithAModule = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+'([^']+)'/gmu;

function importedWith(module: Readonly<URL>): readonly string[] {
  const imported: string[] = [];
  for (const [, name = ''] of readFileSync(module, 'utf8').matchAll(loadedWithAModule)) {
    imported.push(name);
  }
  return imported;
}

function loadedWithTheEntry(entry: Readonly<URL>): ReadonlySet<string> {
  const loaded = new Set<string>();
  const walked = (module: Readonly<URL>): void => {
    for (const imported of importedWith(module)) {
      const file = imported.startsWith('.') ? new URL(imported, module) : undefined;
      const name = file?.href ?? imported;
      if (!loaded.has(name)) {
        loaded.add(name);
        if (file !== undefined) {
          walked(file);
        }
      }
    }
  };
  walked(entry);
  return loaded;
}

describe('the default credential chain of AWS, from the main entry', () => {
  it('loads the credential providers of the AWS SDK only when it is first asked for, never with the entry', async () => {
    const withTheEntry = [...loadedWithTheEntry(theMainEntry)];

    const chain = await awsCredentialChainOf({ enabled: false, environment: {} });

    expect(withTheEntry.filter((loaded) => loaded.startsWith(credentialProviders))).toEqual([]);
    expect(withTheEntry.some((loaded) => loaded.endsWith('/aws/aws-credentials.ts'))).toBe(true);
    expect(importedWith(new URL('aws-clients.ts', import.meta.url))).toContain(credentialProviders);
    expect(typeof chain).toBe('function');
  });
});
