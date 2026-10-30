import type { OutputShape } from '../shapes/output-shape.ts';
import { outputShapeNamed } from '../shapes/output-shapes.ts';

export function shapeNamed(name: string): OutputShape {
  const shape = outputShapeNamed(name);
  if (shape === undefined) {
    throw new Error(`There is no shape ${name}`);
  }
  return shape;
}
