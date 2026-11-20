import {
  publishedOutputOf,
  type CalledDefinition,
  type CallingStep,
  type DefinitionSummary,
  type PreparedDefinition,
} from '@on.auto/definitions';
import type { Contributes } from '@on.auto/definitions/goals';
import {
  allTaskEntries,
  eventFiltersOf,
  field,
  objectField,
  playbookWideFilterOf,
  textField,
  type JsonObject,
  type LocatedFilter,
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

function detailsOf(document: JsonObject, contributes: Contributes | undefined): JsonObject {
  const calls = callsOf(document);
  return {
    ...(calls.length === 0 ? {} : { calls }),
    ...(contributes === undefined ? {} : { contributes }),
  };
}

function descriptionOf(document: JsonObject): string | undefined {
  const header = objectField(document, 'document') ?? {};
  return textField(header, 'summary') ?? textField(header, 'title');
}

export function summaryOf(document: JsonObject, contributes?: Contributes): DefinitionSummary {
  const description = descriptionOf(document);
  const inputSchema = inlineSchemaOf(document, 'input');
  const triggers = triggersOfDocument(document);
  return {
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...publishedOutputOf({
      schema: inlineSchemaOf(document, 'output'),
      shape: outputShapeOf(document),
      details: detailsOf(document, contributes),
    }),
    ...(triggers.length === 0 ? {} : { triggers }),
  };
}

type DefinitionsNamed = NonNullable<PreparedDefinition['definitionsNamed']>;

type NameWritten = DefinitionsNamed['names'][number];

type SubjectWritten = DefinitionsNamed['subjects'][number];

function namesWrittenIn(document: JsonObject): readonly NameWritten[] {
  return allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }): readonly NameWritten[] => {
    const call = definitionCallOf(task);
    return namesItsDefinition(call) ? [{ pointer: `${reference}/with/name`, type: call.type, name: call.name }] : [];
  });
}

function subjectWrittenAt(filter: string, type: string, subject: unknown): readonly SubjectWritten[] {
  return typeof subject === 'string' ? [{ pointer: `${filter}/with/subject`, type, subject }] : [];
}

function subjectsWrittenIn(document: JsonObject): readonly SubjectWritten[] {
  return triggersOfDocument(document).flatMap((trigger) =>
    trigger.kind === 'event'
      ? trigger.filters.flatMap(({ reference, type, attributes }) =>
          subjectWrittenAt(reference, type, attributes['subject']),
        )
      : [],
  );
}

function awaitedOf([filter, pointer]: LocatedFilter): readonly SubjectWritten[] {
  const attributes = playbookWideFilterOf(filter) ?? {};
  const type = textField(attributes, 'type');
  return type === undefined ? [] : subjectWrittenAt(pointer, type, field(attributes, 'subject'));
}

function awaitedIn(document: JsonObject): readonly SubjectWritten[] {
  return allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) => {
    const to = objectField(objectField(task, 'listen') ?? {}, 'to');
    return to === undefined
      ? []
      : eventFiltersOf(to, `${reference}/listen/to`).flatMap((located) => awaitedOf(located));
  });
}

export function definitionsNamedIn(document: JsonObject): DefinitionsNamed {
  return { names: namesWrittenIn(document), subjects: subjectsWrittenIn(document), awaited: awaitedIn(document) };
}
