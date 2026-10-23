import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const libraries: ReadonlySet<string> = new Set([
  '@hyperjump/json-schema-formats',
  '@hyperjump/json-schema/draft-2020-12',
  '@hyperjump/json-schema/experimental',
  '@openworkflowspec/sdk',
]);

function librariesReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => libraries.has(name));
}

describe('the SDK of the specification and the validator of its schema', () => {
  it('are reached by no module the entry of the capability imports, and load with the first document it reads', () => {
    expect(modulesReachedFrom(sources, 'index.ts').files).toContain('dsl/dsl-libraries.ts');
    expect(librariesReachedFrom('index.ts')).toEqual([]);
  });
});
