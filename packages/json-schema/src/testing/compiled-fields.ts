import { Result, type Schema } from 'effect';

import { compileJsonSchema, type CompiledSchema } from '../document/json-schema.ts';
import { stringFormats, type FormatName } from '../document/string-formats.ts';

const asAnInput = { what: 'input', nesting: 64 };

export function compiled(document: Schema.JsonObject): CompiledSchema {
  return Result.getOrThrow(compileJsonSchema(document, asAnInput));
}

export function fieldIssues(field: Schema.JsonObject, value: Schema.Json): unknown {
  return compiled({ type: 'object', properties: { field } }).issuesOf({ field: value });
}

export function formatRefusal(format: FormatName, pointer = '/field') {
  return {
    pointer,
    detail: `Expected a string in the format ${format}, such as ${stringFormats[format].example}`,
    breach: { rule: 'format', format },
  };
}
