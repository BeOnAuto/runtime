import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const clients: ReadonlySet<string> = new Set(['@aws-sdk/client-s3', '@aws-sdk/lib-storage']);

function clientsReachedFrom(entry: string): readonly string[] {
  return modulesReachedFrom(sources, entry).packages.filter((name) => clients.has(name));
}

describe('the S3 client', () => {
  it('is reached from the entry of the adapter, and not from the entry of the location, which the settings read', () => {
    expect(clientsReachedFrom('location/content-location.ts')).toEqual([]);
    expect(clientsReachedFrom('index.ts')).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage']);
  });
});
