import { shapeIssues } from '@on.auto/json-schema';
import { jsonSchema, Output } from 'ai';
import { Result, type Schema } from 'effect';
import type { JSONSchema7 } from 'json-schema';

import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import { AnswerMismatch } from '../model-calls/answer-mismatch.ts';
import { mutableObject } from '../model-calls/call-options.ts';
import type { JsonOutput } from '../model/model-request.ts';
import { portableAnswerOf } from './answer-reading.ts';
import type { PortableForm } from './portable-schema.ts';

const howToAnswer =
  'Answer with only a JSON value that matches this JSON Schema, and no other text. Leave out a property that is not required when you have no value for it.';

export function describedInstructions(instructions: string | undefined, schema: Schema.JsonObject): string {
  const described = `${howToAnswer}\n\n${JSON.stringify(schema)}`;
  return instructions === undefined ? described : `${instructions}\n\n${described}`;
}

export function unreadableSchemaOf({ schema: { document } }: JsonOutput): DefinitionInvalid | undefined {
  const issues = shapeIssues(document);
  return issues.length === 0
    ? undefined
    : new DefinitionInvalid({
        detail: 'The output schema is not one this package can validate',
        provider: null,
        status: null,
        provider_message: null,
        issues: issues.map(({ pointer, detail }) => ({ pointer: `/output/schema${pointer}`, detail })),
      });
}

function portableValidation(schema: JsonOutput['schema'], value: unknown) {
  return Result.match(portableAnswerOf(schema, value), {
    onSuccess: (json) => ({ success: true as const, value: json }),
    onFailure: ({ issues, written }) => ({ success: false as const, error: new AnswerMismatch(issues, written) }),
  });
}

function providerSchemaOf({ sent }: PortableForm): JSONSchema7 {
  return mutableObject(sent);
}

export function portableOutput(output: JsonOutput, form: PortableForm) {
  return Output.object({
    schema: jsonSchema<Schema.Json>(providerSchemaOf(form), {
      validate: (value) => portableValidation(output.schema, value),
    }),
    ...(output.name === undefined ? {} : { name: output.name }),
    ...(output.description === undefined ? {} : { description: output.description }),
  });
}
