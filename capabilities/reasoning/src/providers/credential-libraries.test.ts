import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const libraries: ReadonlySet<string> = new Set([
  '@ai-sdk/google-vertex',
  '@ai-sdk/google-vertex/anthropic',
  '@azure/identity',
  '@on.auto/outbound/aws',
  'google-auth-library',
]);

const importsTheIdentityLibrary = /import\(\s*'@azure\/identity'\s*\)|from\s+'@azure\/identity'/u;

function namingTheIdentityLibrary(entry: string): readonly string[] {
  return modulesReachedFrom(sources, entry).files.filter((file) =>
    importsTheIdentityLibrary.test(readFileSync(join(sources, file), 'utf8')),
  );
}

function librariesReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => libraries.has(name));
}

describe('the credential libraries of the providers', () => {
  it('are reached by no entry of the capability, and load when model access is built with their provider configured', () => {
    expect([...librariesReachedFrom('index.ts'), ...librariesReachedFrom('testing/index.ts')]).toEqual([]);
    expect(librariesReachedFrom('providers/vertex-providers.ts')).toEqual([
      '@ai-sdk/google-vertex',
      '@ai-sdk/google-vertex/anthropic',
      'google-auth-library',
    ]);
  });

  it('are named by no module the main and testing entries reach, so a bundle of them asks for none, and the identity library by the installed-packages entry the server passes it from', () => {
    expect([...namingTheIdentityLibrary('index.ts'), ...namingTheIdentityLibrary('testing/index.ts')]).toEqual([]);
    expect(namingTheIdentityLibrary('providers/installed-packages.ts')).toEqual(['providers/installed-packages.ts']);
  });
});
