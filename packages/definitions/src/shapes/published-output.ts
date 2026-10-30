import type { Schema } from 'effect';

import type { OutputShape } from './output-shape.ts';
import { outputShapeNamed } from './output-shapes.ts';
import type { OutputShapeName } from './shape-names.ts';

type Details = Readonly<Record<string, Schema.Json>>;

export interface DeclaredOutput {
  readonly schema?: Schema.JsonObject | undefined;
  readonly shape?: OutputShape | undefined;
  readonly details?: Details;
}

export interface PublishedOutput {
  readonly outputSchema?: Schema.JsonObject;
  readonly details?: Schema.JsonObject;
}

function detailsOf(details: Details): PublishedOutput {
  return Object.keys(details).length === 0 ? {} : { details };
}

export function publishedOutputOf({ schema, shape, details = {} }: DeclaredOutput): PublishedOutput {
  if (shape !== undefined) {
    return { outputSchema: shape.schema, details: { ...details, shape: shape.name } };
  }
  return { ...(schema === undefined ? {} : { outputSchema: schema }), ...detailsOf(details) };
}

export function shapeNameIn(details?: Schema.JsonObject): OutputShapeName | undefined {
  const shape = details?.['shape'];
  return typeof shape === 'string' ? outputShapeNamed(shape)?.name : undefined;
}
