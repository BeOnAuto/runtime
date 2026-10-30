import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

function objectStorageReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => name.startsWith('@on.auto/object-storage'));
}

describe('the entries of the object store the server imports as it starts', () => {
  it('are the entry of the location alone, which the settings read, and the adapter only when they name a bucket', () => {
    expect(objectStorageReachedFrom('lifecycle/run-server.ts')).toEqual(['@on.auto/object-storage/location']);
    expect(objectStorageReachedFrom('composition/composition-root.ts')).toEqual([]);
  });
});
