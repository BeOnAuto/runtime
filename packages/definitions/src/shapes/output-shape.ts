import { schemaCheckOf, type FurtherCheck, type SchemaCheck } from '@on.auto/json-schema';
import { mostValueDepth } from '@on.auto/workflow-engine/worker';
import type { Schema } from 'effect';

import type { OutputShapeName } from './shape-names.ts';

export interface OutputShape {
  readonly name: OutputShapeName;
  readonly schema: Schema.JsonObject;
  readonly further: FurtherCheck;
  readonly check: SchemaCheck;
}

interface ShapeDeclaration {
  readonly name: OutputShapeName;
  readonly properties: Schema.JsonObject;
  readonly required: readonly string[];
  readonly further: FurtherCheck;
}

const shapeAddress = 'https://on.auto/shapes/';

const mostLabelCharacters = 64;

export const label: Schema.JsonObject = { type: 'string', minLength: 1, maxLength: mostLabelCharacters };

export const amount: Schema.JsonObject = { type: 'number' };

export const lowest: Schema.JsonObject = {
  type: 'number',
  description: 'The lowest the value may be; at most the value',
};

export const highest: Schema.JsonObject = {
  type: 'number',
  description: 'The highest the value may be; at least the value',
};

export function closedRecord(properties: Schema.JsonObject, required: readonly string[]): Schema.JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}

function checkedWhenAsked(schema: Schema.JsonObject, further: FurtherCheck): SchemaCheck {
  let check: SchemaCheck | undefined;
  return (value) => {
    check ??= schemaCheckOf(schema, { what: 'output', nesting: mostValueDepth, further });
    return check(value);
  };
}

export function shapeOf({ name, properties, required, further }: ShapeDeclaration): OutputShape {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${shapeAddress}${name}`,
    title: name,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
  return { name, schema, further, check: checkedWhenAsked(schema, further) };
}
