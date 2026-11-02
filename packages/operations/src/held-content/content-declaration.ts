import { Schema, SchemaAST } from 'effect';

export type JsonPointer = `/${string}`;

export interface ContentDeclaration {
  readonly holds?: readonly JsonPointer[];
  readonly releases?: 'all' | readonly JsonPointer[];
}

export interface FactDeclaration {
  readonly content?: ContentDeclaration;
}

export type ContentHolders = ReadonlyMap<string, ContentDeclaration>;

export const heldContentAnnotation = 'heldContent';

const JsonPointerSchema = Schema.TemplateLiteral(['/', Schema.String]);

const ContentDeclarationSchema = Schema.Struct({
  holds: Schema.optionalKey(Schema.Array(JsonPointerSchema)),
  releases: Schema.optionalKey(Schema.Union([Schema.Literal('all'), Schema.Array(JsonPointerSchema)])),
});

const declarationOf = Schema.decodeUnknownSync(ContentDeclarationSchema);

type Declared = readonly [type: string, declaration: ContentDeclaration];

function typeOf(ast: SchemaAST.Objects): string | undefined {
  const type = ast.propertySignatures.find(({ name }) => name === 'type')?.type;
  return type !== undefined && SchemaAST.isLiteral(type) ? String(type.literal) : undefined;
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
  return type === undefined || declared === undefined ? [] : [[type, declarationOf(declared)]];
}

export function contentHoldersOf(schemas: readonly { readonly ast: SchemaAST.AST }[]): ContentHolders {
  const holders = new Map<string, ContentDeclaration>();
  for (const [type, declaration] of schemas.flatMap(({ ast }) => declaredIn(ast))) {
    const before = holders.get(type);
    if (before !== undefined && JSON.stringify(before) !== JSON.stringify(declaration)) {
      throw new Error(`The fact ${type} declares the content it holds and releases in two ways`);
    }
    holders.set(type, declaration);
  }
  return holders;
}
