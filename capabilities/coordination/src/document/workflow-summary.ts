import { publishedOutputOf, type DefinitionSummary } from '@on.auto/definitions';
import { type JsonObject, objectField, textField } from '@on.auto/workflow-engine';

import { inlineSchemaOf } from './workflow-document.ts';
import { definitionsCalledIn } from './workflow-functions.ts';
import { outputShapeOf } from './workflow-output.ts';
import { triggersOfDocument } from './workflow-schedule.ts';

function callsOf(document: JsonObject): JsonObject {
  const calls = definitionsCalledIn(document);
  return calls.length === 0 ? {} : { calls };
}

export function summaryOf(document: JsonObject): DefinitionSummary {
  const header = objectField(document, 'document') ?? {};
  const description = textField(header, 'summary') ?? textField(header, 'title');
  const inputSchema = inlineSchemaOf(document, 'input');
  const triggers = triggersOfDocument(document);
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...publishedOutputOf({
      schema: inlineSchemaOf(document, 'output'),
      shape: outputShapeOf(document),
      details: callsOf(document),
    }),
    ...(triggers.length === 0 ? {} : { triggers }),
  };
}
