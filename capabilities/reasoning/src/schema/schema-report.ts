import { isKnownKeyword, pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import { Result, type Schema } from 'effect';

import { compileAnswerSchema, type AnswerSchema } from './answer-schema.ts';
import type { NotPortableIssue } from './portable-checks.ts';
import { portableFormOf } from './portable-schema.ts';
import { schemaNodes } from './schema-nodes.ts';

export interface SchemaReport {
  readonly unsupported: readonly SchemaIssue[];
  readonly not_portable: readonly NotPortableIssue[];
  readonly unchecked: readonly SchemaIssue[];
}

function uncheckedKeywordsOf(document: Schema.JsonObject): readonly SchemaIssue[] {
  return schemaNodes(document).flatMap(({ schema, path }) =>
    Object.keys(schema)
      .filter((keyword) => !isKnownKeyword(keyword))
      .map((keyword) => ({
        pointer: pointerOf([...path, keyword]),
        detail: `${keyword} is not a keyword the runtime checks; answers are not checked against it`,
      })),
  );
}

export function answerSchemaReport(schema: AnswerSchema): SchemaReport {
  const form = portableFormOf(schema);
  return {
    unsupported: [],
    not_portable: form.portable ? [] : form.issues,
    unchecked: uncheckedKeywordsOf(schema.document),
  };
}

export function checkAnswerSchema(document: unknown): SchemaReport {
  return Result.match(compileAnswerSchema(document), {
    onFailure: (unsupported): SchemaReport => ({ unsupported, not_portable: [], unchecked: [] }),
    onSuccess: (schema) => answerSchemaReport(schema),
  });
}
