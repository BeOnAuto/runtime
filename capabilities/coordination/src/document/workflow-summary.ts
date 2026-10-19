import {
  publishedOutputOf,
  type CalledDefinition,
  type CallingStep,
  type DefinitionSummary,
} from '@on.auto/definitions';
import { field, type JsonObject, textField } from '@on.auto/workflow-engine';

import { numberedTasksOf, type NumberedTask } from '../steps/placed-tasks.ts';
import { inlineSchemaOf } from './workflow-document.ts';
import { definitionCallOf, namesItsDefinition } from './workflow-functions.ts';
import { outputShapeOf } from './workflow-output.ts';
import { triggersOfDocument } from './workflow-schedule.ts';
import { aboutOf, descriptionOf, headerOf } from './workflow-texts.ts';

interface CallingTask {
  readonly type: string;
  readonly name: string;
  readonly step: CallingStep;
}

function everyTaskOf(tasks: readonly NumberedTask[]): readonly NumberedTask[] {
  return tasks.flatMap((task) => [task, ...everyTaskOf(task.body), ...everyTaskOf(task.recovery)]);
}

function callingTaskOf({ name, task, step }: NumberedTask): readonly CallingTask[] {
  const call = definitionCallOf(task);
  return namesItsDefinition(call) ? [{ type: call.type, name: call.name, step: { number: step, name } }] : [];
}

function isSameDefinition(one: CallingTask, other: CallingTask): boolean {
  return one.type === other.type && one.name === other.name;
}

function callsOf(document: JsonObject): readonly CalledDefinition[] {
  const calling = everyTaskOf(numberedTasksOf(field(document, 'do'))).flatMap((task) => callingTaskOf(task));
  return calling
    .filter((call, index) => calling.findIndex((other) => isSameDefinition(other, call)) === index)
    .map((call) => ({
      type: call.type,
      name: call.name,
      steps: calling.filter((other) => isSameDefinition(other, call)).map(({ step }) => step),
    }));
}

function detailsOf(document: JsonObject, title: string | undefined): JsonObject {
  const calls = callsOf(document);
  return { ...(calls.length === 0 ? {} : { calls }), ...(title === undefined ? {} : { title }) };
}

export function summaryOf(document: JsonObject): DefinitionSummary {
  const header = headerOf(document);
  const title = textField(header, 'title');
  const description = descriptionOf(header)?.text;
  const about = aboutOf(header)?.text;
  const inputSchema = inlineSchemaOf(document, 'input');
  const triggers = triggersOfDocument(document);
  return {
    ...(description === undefined ? {} : { description }),
    ...(about === undefined ? {} : { about }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...publishedOutputOf({
      schema: inlineSchemaOf(document, 'output'),
      shape: outputShapeOf(document),
      details: detailsOf(document, title),
    }),
    ...(triggers.length === 0 ? {} : { triggers }),
  };
}
