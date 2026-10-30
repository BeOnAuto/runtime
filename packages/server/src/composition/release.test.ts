import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { release } from './release.ts';

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })),
);

describe('release', () => {
  it('carries the name and the release version of the repository manifest, which names the product', () => {
    const manifest = manifestOf(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));

    expect(release).toEqual({ name: manifest.name, version: manifest.version });
    expect(release.name).toBe('@on.auto/runtime');
  });
});
