import { readdirSync, readFileSync } from 'node:fs';
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

const checkHandler = 'program-check/handed-checks.ts';

function isAModule(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts');
}

function modulesOfThePackage(): readonly string[] {
  return readdirSync(sources, { recursive: true, encoding: 'utf8' }).filter((file) => isAModule(file));
}

describe('the compiler', () => {
  it('is reached by the check worker, which the pool starts with the first check, and by the entry of the handler it serves, and by no other entry of the package, the check entry among them', () => {
    expect(entries).toEqual([
      'index.ts',
      'check.ts',
      checkHandler,
      'document.ts',
      'template.ts',
      'testing/index.ts',
      'checking/value-checks.ts',
    ]);
    expect(entries.filter((entry) => entry !== checkHandler).flatMap((entry) => compilersReachedFrom(entry))).toEqual(
      [],
    );
    expect(compilersReachedFrom(checkHandler)).toEqual(['ts-blank-space', 'typescript6']);
    expect(compilersReachedFrom('program-check/check-worker.ts')).toEqual(['ts-blank-space', 'typescript6']);
  });

  it('is read, with its lib, from the copy the package depends on, named under the package, so no module of the package resolves a package when it loads', () => {
    const modules = modulesOfThePackage();

    expect(modules.length).toBeGreaterThan(100);
    expect(modules.filter((file) => readFileSync(`${sources}${file}`, 'utf8').includes('import.meta.resolve'))).toEqual(
      [],
    );
  });
});
