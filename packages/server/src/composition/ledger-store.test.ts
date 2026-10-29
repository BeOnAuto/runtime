import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { layoutStepsInSequence } from '@on.auto/ledger';
import { factTypesOf } from '@on.auto/operations';
import type { SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { knownFactSchemas } from './known-facts.ts';
import { layoutSteps } from './ledger-store.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

const fixtureOfARelease = /(?:^|\/)\d+\.\d+\.\d+\/(?<type>[a-z][a-z0-9_]*)\.json$/u;

function fixtureTypesUnder(group: string): readonly string[] {
  return readdirSync(join(repository, group)).flatMap((name) =>
    readdirSync(join(repository, group, name, 'src'), { recursive: true, encoding: 'utf8' }).flatMap(
      (path) => fixtureOfARelease.exec(path)?.groups?.['type'] ?? [],
    ),
  );
}

describe('the steps the server gives the ledger, from every package that owns a table in its database', () => {
  it('lead from the floor to the layout kept by one step for each number, and hold no step to any other', () => {
    const inSequence = layoutStepsInSequence(layoutSteps).map(({ layout }) => layout);

    expect(inSequence).toEqual(layoutSteps.map(({ layout }) => layout).toSorted((one, other) => one - other));
  });
});

describe('the fact types the server gives the ledger to read', () => {
  it('are every fact type a fixture keeps, so a fact any module of the server records is one it reads', () => {
    const factTypes = [
      ...new Set(knownFactSchemas.flatMap((schema: { readonly ast: SchemaAST.AST }) => factTypesOf(schema))),
    ].toSorted();
    const kept = [...new Set([...fixtureTypesUnder('packages'), ...fixtureTypesUnder('capabilities')])].toSorted();

    expect(factTypes).toEqual(kept);
    expect(factTypes).toHaveLength(70);
  });
});
