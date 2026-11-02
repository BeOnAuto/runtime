import { issuesDetail, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { shapeAddress, type OutputShape } from './output-shape.ts';
import { outputShapeOfSchema } from './output-shapes.ts';
import type { OutputShapeName } from './shape-names.ts';
import { recordOf } from './shape-values.ts';

export type ShapedViews = ReadonlyMap<string, OutputShape>;

const shapedViewsAddress = `${shapeAddress}views`;

export function shapedViewsSchemaOf(views: Readonly<Record<string, OutputShapeName>>): Schema.JsonObject {
  return {
    $id: shapedViewsAddress,
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(views).map(([name, shape]: readonly [string, OutputShapeName]) => [
        name,
        { $ref: `${shapeAddress}${shape}` },
      ]),
    ),
    additionalProperties: false,
  };
}

export function shapedViewsIn(schema: Schema.Json | undefined): ShapedViews | undefined {
  const record = recordOf(schema);
  if (record['$id'] !== shapedViewsAddress) {
    return undefined;
  }
  return new Map(
    Object.entries(recordOf(record['properties'])).flatMap(([name, property]: readonly [string, Schema.Json]) => {
      const shape = outputShapeOfSchema({ $id: recordOf(property)['$ref'] ?? null });
      return shape === undefined ? [] : [[name, shape] as const];
    }),
  );
}

function issuesOfView(shape: OutputShape, name: string, view: Schema.Json): readonly SchemaIssue[] {
  const at = `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
  return shape.check(view).map(({ pointer, detail }) => ({ pointer: `${at}${pointer}`, detail }));
}

export function shapedViewsRefusal(shapes: ShapedViews, views: Schema.Json): string | undefined {
  if (typeof views !== 'object' || views === null || Array.isArray(views)) {
    return 'The fold returns an object of named views, each of the shape data.views gives it';
  }
  const undeclared = Object.keys(views).filter((name) => !shapes.has(name));
  if (undeclared.length > 0) {
    return `The fold returned ${undeclared.join(', ')}, which data.views does not declare`;
  }
  const given = Object.entries(views);
  const issues = [...shapes].flatMap(([name, shape]: readonly [string, OutputShape]) =>
    given
      .filter(([each]: readonly [string, Schema.Json]) => each === name)
      .flatMap(([, view]: readonly [string, Schema.Json]) => issuesOfView(shape, name, view)),
  );
  return issues.length === 0 ? undefined : issuesDetail(issues, 'views');
}
