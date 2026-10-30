import { Option, Predicate, Schema, SchemaAST } from 'effect';

function membersOf(ast: SchemaAST.AST): readonly SchemaAST.AST[] {
  return SchemaAST.isUnion(ast) ? ast.types : [ast];
}

export function encodedMembersOf(schema: Schema.Constraint): readonly SchemaAST.AST[] {
  return membersOf(SchemaAST.toEncoded(Schema.toCodecJson(schema).ast));
}

export function handlerMembersOf(schema: Schema.Constraint): readonly SchemaAST.AST[] {
  return membersOf(SchemaAST.toType(schema.ast));
}

function bodyOf(member: SchemaAST.Objects, pathParameters: readonly string[]): Schema.Codec<unknown> {
  const fields = member.propertySignatures.filter(({ name }) => !pathParameters.includes(String(name)));
  return Schema.make<Schema.Codec<unknown>>(
    new SchemaAST.Objects(
      fields,
      member.indexSignatures,
      member.annotations,
      member.checks,
      member.encoding,
      member.context,
      member.encodingChecks,
    ),
  );
}

export function refusesEmptyBody(schema: Schema.Constraint, pathParameters: readonly string[]): boolean {
  return membersOf(Schema.toCodecJson(schema).ast)
    .filter((member) => SchemaAST.isObjects(member))
    .every((member) => Option.isNone(Schema.decodeUnknownOption(bodyOf(member, pathParameters))({})));
}

function isEmptyStruct(ast: SchemaAST.AST): boolean {
  return SchemaAST.isObjects(ast) && ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0;
}

export function isClosedObject(ast: SchemaAST.AST): ast is SchemaAST.Objects {
  return (
    SchemaAST.isObjects(ast) && ast.indexSignatures.every(({ type }) => SchemaAST.isNever(type)) && !isEmptyStruct(ast)
  );
}

function childrenOf(ast: SchemaAST.AST): readonly SchemaAST.AST[] {
  if (SchemaAST.isObjects(ast)) {
    return [...ast.propertySignatures.map(({ type }) => type), ...ast.indexSignatures.map(({ type }) => type)];
  }
  if (SchemaAST.isUnion(ast)) {
    return ast.types;
  }
  if (SchemaAST.isArrays(ast)) {
    return [...ast.elements, ...ast.rest];
  }
  return SchemaAST.isSuspend(ast) ? [ast.thunk()] : [];
}

export function holdsEmptyStruct(ast: SchemaAST.AST, ancestors: readonly SchemaAST.AST[]): boolean {
  return (
    !ancestors.includes(ast) &&
    (isEmptyStruct(ast) || childrenOf(ast).some((child) => holdsEmptyStruct(child, [...ancestors, ast])))
  );
}

export function fieldOf(member: SchemaAST.Objects, name: string): SchemaAST.PropertySignature | undefined {
  return member.propertySignatures.find((field) => field.name === name);
}

function isEncodedString(ast: SchemaAST.AST): boolean {
  if (SchemaAST.isUnion(ast)) {
    return ast.types.every((member) => isEncodedString(member));
  }
  return (
    SchemaAST.isString(ast) ||
    SchemaAST.isTemplateLiteral(ast) ||
    (SchemaAST.isLiteral(ast) && Predicate.isString(ast.literal))
  );
}

export function isRequiredStringField(field: SchemaAST.PropertySignature | undefined): boolean {
  return field !== undefined && !SchemaAST.isOptional(field.type) && isEncodedString(field.type);
}
