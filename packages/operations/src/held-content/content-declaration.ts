import { JsonPointer as Pointers, Schema, SchemaAST } from 'effect';

export type JsonPointer = `/${string}`;

export interface PayloadPointers {
  readonly sha256: JsonPointer;
  readonly bytes: JsonPointer;
}

export interface ContentDeclaration {
  readonly holds?: readonly JsonPointer[];
  readonly releases?: 'all' | readonly JsonPointer[];
  readonly payloads?: readonly PayloadPointers[];
}

export interface FactDeclaration {
  readonly content?: ContentDeclaration;
}

export type ContentHolders = ReadonlyMap<string, ContentDeclaration>;

export const heldContentAnnotation = 'heldContent';

export const keptPayloadAnnotation = 'keptPayload';

export const everyElement = '*';

const JsonPointerSchema = Schema.TemplateLiteral(['/', Schema.String]);

function parentOf(pointer: JsonPointer): string {
  return pointer.slice(0, pointer.lastIndexOf('/'));
}

function membersOfOneObject({ sha256, bytes }: PayloadPointers): boolean {
  return sha256 !== bytes && parentOf(sha256) === parentOf(bytes);
}

const PayloadPointersSchema = Schema.Struct({ sha256: JsonPointerSchema, bytes: JsonPointerSchema }).check(
  Schema.makeFilter(membersOfOneObject, {
    expected: `the two pointers of a payload, two members of one object, with ${everyElement} for each element of a list`,
  }),
);

const ContentDeclarationSchema = Schema.Struct({
  holds: Schema.optionalKey(Schema.Array(JsonPointerSchema)),
  releases: Schema.optionalKey(Schema.Union([Schema.Literal('all'), Schema.Array(JsonPointerSchema)])),
  payloads: Schema.optionalKey(Schema.Array(PayloadPointersSchema)),
});

const declarationOf = Schema.decodeUnknownSync(ContentDeclarationSchema);

type Declared = readonly [type: string, declaration: ContentDeclaration];

function typeOf(ast: SchemaAST.Objects): string | undefined {
  const type = ast.propertySignatures.find(({ name }) => name === 'type')?.type;
  return type !== undefined && SchemaAST.isLiteral(type) ? String(type.literal) : undefined;
}

function payloadNamedBy(member: SchemaAST.AST): readonly string[] {
  const name: unknown = SchemaAST.resolve(member)?.[keptPayloadAnnotation];
  return typeof name === 'string' ? [name] : [];
}

function pointersOf(name: string, within: JsonPointer | ''): PayloadPointers {
  return {
    sha256: `${within}/${Pointers.escapeToken(`${name}_sha256`)}`,
    bytes: `${within}/${Pointers.escapeToken(`${name}_bytes`)}`,
  };
}

function keptPointersIn(ast: SchemaAST.AST, within: JsonPointer | ''): readonly PayloadPointers[] {
  if (SchemaAST.isUnion(ast)) {
    return ast.types.flatMap((member) => keptPointersIn(member, within));
  }
  if (SchemaAST.isArrays(ast)) {
    return ast.rest.flatMap((element) => keptPointersIn(element, `${within}/${everyElement}`));
  }
  if (!SchemaAST.isObjects(ast)) {
    return [];
  }
  return ast.propertySignatures.flatMap(({ name, type }) => [
    ...payloadNamedBy(type).map((payload) => pointersOf(payload, within)),
    ...keptPointersIn(type, `${within}/${Pointers.escapeToken(String(name))}`),
  ]);
}

function requireKeptDeclared(type: string, fact: SchemaAST.Objects, { payloads = [] }: ContentDeclaration): void {
  const data = fact.propertySignatures.find(({ name }) => name === 'data')?.type;
  const declared = new Set(payloads.map((pair) => JSON.stringify(pair)));
  const undeclared = (data === undefined ? [] : keptPointersIn(data, '')).filter(
    (pair) => !declared.has(JSON.stringify(pair)),
  );
  if (undeclared.length > 0) {
    throw new Error(
      `The fact ${type} may keep ${undeclared.map(({ sha256 }) => sha256).join(', ')} outside it but declares no payload there, so nothing would hold its content`,
    );
  }
}

function declaredIn(ast: SchemaAST.AST): readonly Declared[] {
  if (SchemaAST.isUnion(ast)) {
    return ast.types.flatMap((member) => declaredIn(member));
  }
  if (!SchemaAST.isObjects(ast)) {
    return [];
  }
  const type = typeOf(ast);
  const declared: unknown = SchemaAST.resolve(ast)?.[heldContentAnnotation];
  if (type === undefined) {
    return [];
  }
  const declaration = declared === undefined ? {} : declarationOf(declared);
  requireKeptDeclared(type, ast, declaration);
  return declared === undefined ? [] : [[type, declaration]];
}

function requireNoPayloadReleased(declared: readonly Declared[]): readonly Declared[] {
  const keeping = declared.filter(([, { payloads = [] }]) => payloads.length > 0).map(([type]) => type);
  const releasing = declared.filter(([, { releases }]) => releases === 'all').map(([type]) => type);
  if (keeping.length > 0 && releasing.length > 0) {
    throw new Error(
      `The facts ${keeping.join(', ')} keep payloads among facts that release every hold of their stream, ${releasing.join(', ')}, which would leave a payload unheld while a fact names it`,
    );
  }
  return declared;
}

export function contentHoldersOf(schemas: readonly { readonly ast: SchemaAST.AST }[]): ContentHolders {
  const holders = new Map<string, ContentDeclaration>();
  for (const [type, declaration] of schemas.flatMap(({ ast }) => requireNoPayloadReleased(declaredIn(ast)))) {
    const before = holders.get(type);
    if (before !== undefined && JSON.stringify(before) !== JSON.stringify(declaration)) {
      throw new Error(`The fact ${type} declares the content it holds and releases in two ways`);
    }
    holders.set(type, declaration);
  }
  return holders;
}
