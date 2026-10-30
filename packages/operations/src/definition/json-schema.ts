import { Schema } from 'effect';

interface JsonSchema {
  readonly [keyword: string]: unknown;
}

export interface JsonSchemaDocument {
  readonly schema: JsonSchema;
  readonly definitions: { readonly [name: string]: JsonSchema };
}

export function jsonSchemaDocumentOf(schema: Schema.Constraint): JsonSchemaDocument {
  const { schema: root, definitions } = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' });
  return { schema: { type: 'object', ...root }, definitions };
}
