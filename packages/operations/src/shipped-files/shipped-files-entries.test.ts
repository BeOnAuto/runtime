import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { modulesReachedFrom } from '../module-testing/modules-reached.ts';

const source = join(import.meta.dirname, '..');

const diskReader = 'shipped-files/shipped-files-on-disk.ts';

const decodeExports = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ exports: Schema.Record(Schema.String, Schema.String) })),
);

describe('the entries of the package', () => {
  it('keep the reader of the shipped files on disk behind an entry of its own, so the main and testing entries reach no file system for it', () => {
    const { exports } = decodeExports(readFileSync(join(source, '../package.json'), 'utf8'));
    const main = modulesReachedFrom(source, 'index.ts');
    const testing = modulesReachedFrom(source, 'testing/index.ts');

    expect(exports['./shipped-files-on-disk']).toBe(`./src/${diskReader}`);
    expect(modulesReachedFrom(source, diskReader).packages).toEqual([
      'effect',
      'node:fs/promises',
      'node:module',
      'node:url',
    ]);
    expect(main.files).toContain('dispatch/dispatcher.ts');
    expect(main.files).not.toContain(diskReader);
    expect(testing.files).toContain('shipped-files/shipped-files-in-memory.ts');
    expect(testing.files).not.toContain(diskReader);
  });
});
