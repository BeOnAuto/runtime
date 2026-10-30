import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const compilers: ReadonlySet<string> = new Set(['typescript', 'typescript6', 'ts-blank-space']);

const packageFolder = fileURLToPath(new URL('../..', import.meta.url));

const importSpecifier = /^\s*(?:import|export)\s(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gmu;

function everyFileUnder(folder: string): readonly string[] {
  return readdirSync(join(packageFolder, folder), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(folder, file));
}

function compilersImportedBy(file: string): readonly string[] {
  return [...readFileSync(join(packageFolder, file), 'utf8').matchAll(importSpecifier)]
    .map(([, specifier = '']: readonly string[]) => specifier)
    .filter((specifier) => compilers.has(specifier))
    .map((specifier) => `${file}: ${specifier}`);
}

const declaredPackages = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      dependencies: Schema.Record(Schema.String, Schema.String),
      devDependencies: Schema.Record(Schema.String, Schema.String),
    }),
  ),
)(readFileSync(join(packageFolder, 'package.json'), 'utf8'));

describe('the compiler', () => {
  it('is reachable from no module of the engine, its tests and measures among them, nor installed for it, since the check at save strips every program and expression the engine runs', () => {
    const files = [...everyFileUnder('src'), ...everyFileUnder('measure'), 'measure.ts'];

    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap((file) => compilersImportedBy(file))).toEqual([]);
    expect(
      [...Object.keys(declaredPackages.dependencies), ...Object.keys(declaredPackages.devDependencies)].filter((name) =>
        compilers.has(name),
      ),
    ).toEqual([]);
    expect(compilersImportedBy('../definitions/src/program-check/type-stripping.ts')).toEqual([
      '../definitions/src/program-check/type-stripping.ts: ts-blank-space',
      '../definitions/src/program-check/type-stripping.ts: typescript6',
    ]);
  });
});
