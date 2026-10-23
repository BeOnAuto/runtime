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

function librariesReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => libraries.has(name));
}

describe('the credential libraries of the providers', () => {
  it('are reached by no entry of the capability, and load when model access is built with their provider configured', () => {
    expect([...librariesReachedFrom('index.ts'), ...librariesReachedFrom('testing/index.ts')]).toEqual([]);
    expect(librariesReachedFrom('adapter/vertex-providers.ts')).toEqual([
      '@ai-sdk/google-vertex',
      '@ai-sdk/google-vertex/anthropic',
      'google-auth-library',
    ]);
  });
});
