import { Buffer } from 'node:buffer';

import { wordedIssuesOf } from '@on.auto/definitions';
import { compileJsonSchema } from '@on.auto/json-schema';
import { asSentence, type Issue } from '@on.auto/operations';
import { Result, type Schema } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';

function refusalOf(detail: string): readonly Issue[] {
  return [{ pointer: '', detail: asSentence(detail) }];
}

const unreadableSchema = refusalOf('The answer schema of the request cannot be read');

function issuesOfAnswer(answer: Schema.Json, schema: Schema.JsonObject): readonly Issue[] {
  const bytes = Buffer.byteLength(JSON.stringify(answer), 'utf8');
  if (bytes > interactionBounds.answerBytes) {
    return refusalOf(
      `The answer takes ${bytes} bytes as JSON, more than the ${interactionBounds.answerBytes} an answer may`,
    );
  }
  return Result.match(compileJsonSchema(schema, { what: 'answer', nesting: interactionBounds.answerDepth }), {
    onFailure: () => unreadableSchema,
    onSuccess: (compiled) => wordedIssuesOf(compiled, answer),
  });
}

export function answerIssuesOf(answer: Schema.Json, schema: Schema.JsonObject): readonly Issue[] {
  return issuesOfAnswer(answer, schema).map(({ pointer, detail }) => ({ pointer: `/answer${pointer}`, detail }));
}
