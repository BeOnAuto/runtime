import { issuesDetail } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { categoriesShape } from './categories-shape.ts';
import type { OutputShape } from './output-shape.ts';
import { seriesShape } from './series-shape.ts';
import type { OutputShapeName } from './shape-names.ts';
import { recordOf } from './shape-values.ts';
import { tableShape } from './table-shape.ts';
import { textShape } from './text-shape.ts';

const shapesByName: Readonly<Record<OutputShapeName, OutputShape>> = {
  series: seriesShape,
  categories: categoriesShape,
  table: tableShape,
  text: textShape,
};

const shapes: readonly OutputShape[] = Object.values(shapesByName);

export function outputShapeOf(name: OutputShapeName): OutputShape {
  return shapesByName[name];
}

export function outputShapeNames(): readonly OutputShapeName[] {
  return shapes.map(({ name }) => name);
}

export function outputShapeNamed(name: string): OutputShape | undefined {
  return shapes.find((shape) => shape.name === name);
}

export function outputShapeOfSchema(schema: Schema.Json): OutputShape | undefined {
  const address = recordOf(schema)['$id'];
  return shapes.find((shape) => shape.schema['$id'] === address);
}

export function shapeMismatchOf(shape: OutputShape, output: Schema.Json): string | undefined {
  const issues = shape.check(output);
  return issues.length === 0 ? undefined : issuesDetail(issues, 'output');
}
