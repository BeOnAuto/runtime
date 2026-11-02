import { alternatives } from '@on.auto/phrasing';
import { Result, type Schema } from 'effect';

import type { OutputShape } from './output-shape.ts';
import { declarableShapeNames, outputShapeOf } from './output-shapes.ts';

export interface ShapeRefusal {
  readonly at: 'shape' | 'schema';
  readonly detail: string;
}

const shapeBesideSchema = "An output that names a shape takes no schema: the shape's schema is its schema";

export function declaredShape(shape: Schema.Json, besideSchema: boolean): Result.Result<OutputShape, ShapeRefusal> {
  if (besideSchema) {
    return Result.fail({ at: 'schema', detail: shapeBesideSchema });
  }
  const declarable = declarableShapeNames();
  const named = declarable.find((name) => name === shape);
  return named === undefined
    ? Result.fail({ at: 'shape', detail: `Expected the name of a shape: ${alternatives(declarable)}` })
    : Result.succeed(outputShapeOf(named));
}
