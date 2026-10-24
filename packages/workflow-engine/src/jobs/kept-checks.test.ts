import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { keptFor } from '../worker.ts';
import { unchecked } from './program-answer.ts';

function schemaOf(title: string, padding = 100_000): JsonObject {
  return { title, description: '.'.repeat(padding) };
}

function compiledFor(schemas: readonly Json[]): readonly unknown[] {
  const compiled: unknown[] = [];
  const kept = keptFor({
    output: (schema) => {
      compiled.push(Reflect.get(new Object(schema), 'title'));
      return unchecked;
    },
    view: () => () => 'never asked',
  });
  for (const schema of schemas) {
    kept.outputCheck(schema);
  }
  return compiled;
}

describe('the checks keptFor keeps, as the worker entry exports it for a shell that serves the jobs itself', () => {
  it('compiles a schema once and keeps it while its text fits the cache, forgetting the one used longest ago', () => {
    const [first, second, third] = [schemaOf('first'), schemaOf('second'), schemaOf('third')];

    expect(compiledFor([first, second, first, third, first, second])).toEqual(['first', 'second', 'third', 'second']);
  });

  it('compiles a schema longer than the cache for every job, and checks no output whose schema is null', () => {
    const longest = schemaOf('longest', 262_145);

    expect(compiledFor([longest, longest, null, null])).toEqual(['longest', 'longest']);
  });
});
