import { schemaCheckOf, type SchemaIssue } from '@on.auto/json-schema';
import { InvalidInput } from '@on.auto/operations';
import { mostValueDepth } from '@on.auto/workflow-engine/worker';
import { Clock, Effect, type Schema } from 'effect';

import type { StoredDefinition } from '../registry/definition.ts';
import { outputShapeOfSchema } from '../shapes/output-shapes.ts';
import type { RunShown } from './page-rendering.ts';

function outputIssues(schema: Schema.JsonObject, output: Schema.Json): readonly SchemaIssue[] {
  const shape = outputShapeOfSchema(schema);
  const further = shape === undefined ? {} : { further: shape.further };
  return schemaCheckOf(schema, { what: 'output', nesting: mostValueDepth, ...further })(output);
}

const sampleRefused = 'The sample output does not match the output schema of the page’s subject';

export const sampleRunOf = Effect.fnUntraced(function* (subject: StoredDefinition, sample: Schema.Json) {
  const issues = subject.output_schema === undefined ? [] : outputIssues(subject.output_schema, sample);
  if (issues.length > 0) {
    return yield* new InvalidInput({
      detail: sampleRefused,
      issues: issues.map(({ pointer, detail }) => ({ pointer: `/sample_output${pointer}`, detail })),
    });
  }
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();
  const run: RunShown = { status: 'succeeded', output: sample, started: now, ended: now, version: subject.version };
  return run;
});
