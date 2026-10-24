import { shapeIssues } from '@on.auto/json-schema';
import { jsonSchema, Output } from 'ai';
import { Result, type Schema } from 'effect';
import type { JSONSchema7 } from 'json-schema';

import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import { AnswerMismatch } from '../model-calls/answer-mismatch.ts';
import type { JsonOutput } from '../model/model-request.ts';
import type { AnswerSchema } from './answer-schema.ts';

function isProviderSchema(document: Schema.JsonObject): document is Schema.JsonObject & JSONSchema7 {
  return shapeIssues(document).length === 0;
}

function validation(schema: AnswerSchema, value: unknown) {
  return Result.match(schema.validate(value), {
    onSuccess: (json) => ({ success: true as const, value: json }),
    onFailure: (issues) => ({ success: false as const, error: new AnswerMismatch(issues) }),
  });
}

function unreadableSchema(document: Schema.JsonObject): DefinitionInvalid {
  return new DefinitionInvalid({
    detail: 'The output schema is not one this package can validate',
    provider: null,
    status: null,
    provider_message: null,
    issues: shapeIssues(document).map(({ pointer, detail }) => ({ pointer: `/output/schema${pointer}`, detail })),
  });
}

export function jsonOutput(output: JsonOutput) {
  const { document } = output.schema;
  if (!isProviderSchema(document)) {
    return Result.fail(unreadableSchema(document));
  }
  return Result.succeed(
    Output.object({
      schema: jsonSchema<Schema.Json>(document, { validate: (value) => validation(output.schema, value) }),
      ...(output.name === undefined ? {} : { name: output.name }),
      ...(output.description === undefined ? {} : { description: output.description }),
    }),
  );
}
