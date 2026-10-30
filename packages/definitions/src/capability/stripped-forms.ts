import { enclosedBody } from '@on.auto/workflow-engine';
import { Array, Schema } from 'effect';

export const StrippedFormsSchema = Schema.Struct({
  module: Schema.optionalKey(Schema.String),
  expressions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

export type StrippedForms = typeof StrippedFormsSchema.Type;

export const noStrippedForms: StrippedForms = {};

export function changedExpressions(
  sources: readonly string[],
  stripped: readonly string[],
): Pick<StrippedForms, 'expressions'> {
  const changed = Array.zip(sources, stripped).filter(
    ([source, javascript]: readonly [string, string]) => javascript !== source,
  );
  return changed.length === 0 ? {} : { expressions: Object.fromEntries(changed) };
}

export function runnableExpression({ expressions }: StrippedForms, source: string): string {
  return expressions?.[source] ?? source;
}

function runnableValue(value: Schema.Json, stripped: StrippedForms): Schema.Json {
  if (typeof value !== 'string') {
    return value;
  }
  const body = enclosedBody(value);
  if (body === undefined) {
    return value;
  }
  const javascript = runnableExpression(stripped, body);
  return javascript === body ? value : value.replace(body, () => javascript);
}

export function runnableAttributes(
  attributes: Schema.JsonObject,
  stripped: StrippedForms,
): Readonly<Record<string, Schema.Json>> {
  return Object.fromEntries(
    Object.entries(attributes).map(
      ([name, value]: readonly [string, Schema.Json]) => [name, runnableValue(value, stripped)] as const,
    ),
  );
}
