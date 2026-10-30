import {
  publishedOutputOf,
  type CalledDefinition,
  type CallingStep,
  type DefinitionSummary,
} from '@on.auto/definitions';
import {
  allTaskEntries,
  field,
  objectField,
  textField,
  type JsonObject,
  type TaskEntry,
} from '@on.auto/workflow-engine';

import { inlineSchemaOf } from './workflow-document.ts';
import { definitionCallOf, namesItsDefinition } from './workflow-functions.ts';
import { outputShapeOf } from './workflow-output.ts';
import { triggersOfDocument } from './workflow-schedule.ts';

interface CallingTask {
  readonly type: string;
  readonly name: string;
  readonly step: CallingStep;
}

function callingTaskOf({ name, task }: TaskEntry, number: number): readonly CallingTask[] {
  const call = definitionCallOf(task);
  return namesItsDefinition(call) ? [{ type: call.type, name: call.name, step: { number, name } }] : [];
}

function isSameDefinition(one: CallingTask, other: CallingTask): boolean {
  return one.type === other.type && one.name === other.name;
}

function callsOf(document: JsonObject): readonly CalledDefinition[] {
  const calling = allTaskEntries(field(document, 'do'), '/do').flatMap((entry, index) =>
    callingTaskOf(entry, index + 1),
  );
  return calling
    .filter((call, index) => calling.findIndex((other) => isSameDefinition(other, call)) === index)
    .map((call) => ({
      type: call.type,
      name: call.name,
      steps: calling.filter((other) => isSameDefinition(other, call)).map(({ step }) => step),
    }));
}

function detailsOf(document: JsonObject): JsonObject {
  const calls = callsOf(document);
  return calls.length === 0 ? {} : { calls };
}

function descriptionOf(document: JsonObject): string | undefined {
  const header = objectField(document, 'document') ?? {};
  return textField(header, 'summary') ?? textField(header, 'title');
}

export function summaryOf(document: JsonObject): DefinitionSummary {
  const description = descriptionOf(document);
  const inputSchema = inlineSchemaOf(document, 'input');
  const triggers = triggersOfDocument(document);
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...publishedOutputOf({
      schema: inlineSchemaOf(document, 'output'),
      shape: outputShapeOf(document),
      details: detailsOf(document),
    }),
    ...(triggers.length === 0 ? {} : { triggers }),
  };
}
