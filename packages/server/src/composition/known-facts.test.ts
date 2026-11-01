import { factTypesOf } from '@on.auto/operations';
import type { SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { forecastChecked } from '../testing/extensions/declared-facts.ts';
import { factSchemasKnownWith, knownFactSchemas } from './known-facts.ts';

function typesOf(schemas: readonly { readonly ast: SchemaAST.AST }[]): readonly string[] {
  return [...new Set(schemas.flatMap((schema) => factTypesOf(schema)))].toSorted();
}

describe('the fact schemas the server gives the ledger as it opens', () => {
  it('are the ones it composes and the schema of each fact a capability declares on runs, so a declared type is read at start', () => {
    expect(typesOf(factSchemasKnownWith([forecastChecked]))).toEqual(
      [...typesOf(knownFactSchemas), 'forecast_checked'].toSorted(),
    );
  });

  it('are the ones it composes alone where no capability declares a fact on runs, so no other type is read', () => {
    expect(factSchemasKnownWith([])).toEqual(knownFactSchemas);
  });
});
