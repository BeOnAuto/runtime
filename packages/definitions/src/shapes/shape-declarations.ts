import { alternatives } from '@on.auto/operations';
import { Result, type Schema } from 'effect';

import type { OutputShape } from './output-shape.ts';
import { outputShapeNamed, outputShapeNames } from './output-shapes.ts';

export interface ShapeRefusal {
  readonly at: 'shape' | 'schema';
  readonly detail: string;
}

const shapeBesideSchema = "An output that names a shape takes no schema: the shape's schema is its schema";

export function declaredShape(shape: Schema.Json, besideSchema: boolean): Result.Result<OutputShape, ShapeRefusal> {
  if (besideSchema) {
    return Result.fail({ at: 'schema', detail: shapeBesideSchema });
  }
  const named = typeof shape === 'string' ? outputShapeNamed(shape) : undefined;
  return named === undefined
    ? Result.fail({ at: 'shape', detail: `Expected the name of a shape: ${alternatives(outputShapeNames())}` })
    : Result.succeed(named);
}
