import { Schema, SchemaAST } from 'effect';

import { recordedFieldsOf, type Recorded } from '../ledger/decider.ts';

function typesIn(ast: SchemaAST.AST): readonly string[] {
  if (SchemaAST.isUnion(ast)) {
    return ast.types.flatMap((member) => typesIn(member));
  }
  const type = SchemaAST.isObjects(ast) ? ast.propertySignatures.find(({ name }) => name === 'type')?.type : undefined;
  return type !== undefined && SchemaAST.isLiteral(type) ? [String(type.literal)] : [];
}

export function factTypesOf(schema: { readonly ast: SchemaAST.AST }): readonly string[] {
  return [...new Set(typesIn(SchemaAST.toEncoded(schema.ast)))].toSorted();
}

export type FactReader<Fact extends Recorded> = (recorded: unknown) => Fact | undefined;

export function factReaderOf<Fact extends Recorded>(schema: Schema.ConstraintCodec<Fact, unknown>): FactReader<Fact> {
  const types: ReadonlySet<unknown> = new Set(factTypesOf(schema));
  const decodeFact = Schema.decodeUnknownSync(Schema.toCodecJson(schema));
  return (recorded) => {
    const fields = recordedFieldsOf(recorded);
    return types.has(fields.type) ? decodeFact(fields) : undefined;
  };
}
