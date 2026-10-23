import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const sources = fileURLToPath(new URL('..', import.meta.url));

const compilers: ReadonlySet<string> = new Set(['typescript6', 'ts-blank-space']);

const { exports } = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ exports: Schema.Record(Schema.String, Schema.String) })),
)(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const entries = Object.values(exports).map((path) => path.replace(/^\.\/src\//u, ''));

function compilersReachedFrom(entry: string): readonly string[] {
  return modulesReachedFrom(sources, entry).packages.filter((name) => compilers.has(name));
}

describe('the compiler', () => {
  it('is reached by no entry of the package, the check entry among them, and by the check worker, which the pool starts with the first check', () => {
    expect(entries).toEqual(['index.ts', 'check.ts', 'document.ts', 'template.ts', 'testing/index.ts']);
    expect(entries.flatMap((entry) => compilersReachedFrom(entry))).toEqual([]);
    expect(compilersReachedFrom('program-check/check-worker.ts')).toEqual(['ts-blank-space', 'typescript6']);
  });
});
