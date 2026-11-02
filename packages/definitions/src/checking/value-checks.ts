import { issuesDetail, schemaCheckOf } from '@on.auto/json-schema';
import type { ValueChecks } from '@on.auto/workflow-engine/job-loop';
import { mostValueDepth, type Json, type OutputCheck, type ViewCheck } from '@on.auto/workflow-engine/worker';

import { outputShapeOfSchema } from '../shapes/output-shapes.ts';
import { shapedViewsIn, shapedViewsRefusal, type ShapedViews } from '../shapes/shaped-views.ts';

export function outputCheckOf(schema: Json): OutputCheck {
  const shape = outputShapeOfSchema(schema);
  return schemaCheckOf(schema, {
    what: 'output',
    nesting: mostValueDepth,
    ...(shape === undefined ? {} : { further: shape.further }),
  });
}

function shapedViewsCheck(shapes: ShapedViews): ViewCheck {
  return (views) => {
    const detail = shapedViewsRefusal(shapes, views);
    return detail === undefined ? undefined : { kind: 'shape', detail };
  };
}

export function viewCheckOf(schema: Json): ViewCheck {
  const shapes = shapedViewsIn(schema);
  if (shapes !== undefined) {
    return shapedViewsCheck(shapes);
  }
  const check = schemaCheckOf(schema, { what: 'view', nesting: mostValueDepth });
  return (view) => {
    const issues = check(view);
    return issues.length === 0 ? undefined : { kind: 'schema', detail: issuesDetail(issues, 'view') };
  };
}

export const valueChecks: ValueChecks = { output: outputCheckOf, view: viewCheckOf };
