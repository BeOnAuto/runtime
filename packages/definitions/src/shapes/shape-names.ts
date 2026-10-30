import { Schema } from 'effect';

export const OutputShapeNameSchema = Schema.Literals(['series', 'categories', 'table', 'text']);

export type OutputShapeName = typeof OutputShapeNameSchema.Type;
