import {
  allTaskEntries,
  entriesOf,
  field,
  isList,
  isObject,
  nestedTaskLists,
  objectField,
  pointerTo,
  taskEntries,
  textField,
  type Json,
  type JsonEntry,
  type JsonObject,
  type TaskList,
} from '@on.auto/workflow-engine';
import { buildGraph, Classes } from '@openworkflowspec/sdk';
import specificationPackage from '@openworkflowspec/sdk/package.json' with { type: 'json' };
import { Predicate, Schema } from 'effect';
import satisfies from 'semver/functions/satisfies.js';

import { withoutOutputShape } from '../document/workflow-output.ts';
import { problemsOf, type Problem } from './schema-problems.ts';
import { schemaChecksOf } from './specification-schema.ts';

type Workflow = ReturnType<typeof Classes.Workflow.deserialize>;

type Reading = { readonly text: string; readonly document: JsonObject } | { readonly problems: readonly Problem[] };

const standardOf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.JsonObject));

const { supportedDslVersions } = specificationPackage;

export async function dslProblems(
  document: JsonObject,
  { connecting }: { readonly connecting: boolean },
): Promise<readonly Problem[]> {
  const reading = read(document);
  if ('problems' in reading) {
    return reading.problems;
  }
  const unread = firstFound([() => versionProblems(reading.document), () => illFormedNames(reading.document, '')]);
  if (unread.length > 0) {
    return unread;
  }
  const refused = (await schemaChecksOf(reading.document)).flatMap((check) => problemsOf(check));
  return refused.length > 0
    ? refused
    : firstFound([() => duplicatedNames(reading.document), () => (connecting ? connectionProblems(reading.text) : [])]);
}

function firstFound(checks: readonly (() => readonly Problem[])[]): readonly Problem[] {
  return checks.reduce<readonly Problem[]>((found, check) => (found.length > 0 ? found : check()), []);
}

function read(document: JsonObject): Reading {
  try {
    const text = JSON.stringify(withoutOutputShape(document), standardErrors);
    return { text, document: standardOf(text) };
  } catch (error) {
    return { problems: [{ pointer: '', detail: messageOf(error) }] };
  }
}

const errorExtensions: ReadonlySet<string> = new Set(['kind', 'because']);

function withoutExtensions(definition: unknown): unknown {
  return Predicate.isObject(definition)
    ? Object.fromEntries(
        Object.entries(definition).filter(([key]: readonly [string, unknown]) => !errorExtensions.has(key)),
      )
    : definition;
}

function standardErrors(key: string, value: unknown): unknown {
  if (key === 'raise' && Predicate.hasProperty(value, 'error') && Predicate.isObject(value.error)) {
    return { ...value, error: withoutExtensions(value.error) };
  }
  if (key === 'use' && Predicate.hasProperty(value, 'errors') && Predicate.isObject(value.errors)) {
    const errors = Object.entries(value.errors).map(
      ([name, error]: readonly [string, unknown]): readonly [string, unknown] => [name, withoutExtensions(error)],
    );
    return { ...value, errors: Object.fromEntries<unknown>(errors) };
  }
  return value;
}

function versionProblems(document: JsonObject): readonly Problem[] {
  const dsl = textField(objectField(document, 'document') ?? {}, 'dsl');
  return dsl === undefined || satisfies(dsl, supportedDslVersions, { includePrerelease: true })
    ? []
    : [
        {
          pointer: '/document/dsl',
          detail: `This runtime runs documents of the DSL versions ${supportedDslVersions}, not ${dsl}`,
        },
      ];
}

function illFormedNames(value: Json, pointer: string): readonly Problem[] {
  if (isList(value)) {
    return value.flatMap((item, index) => illFormedNames(item, pointerTo(pointer, index)));
  }
  return isObject(value)
    ? entriesOf(value).flatMap(([name, item]: JsonEntry) =>
        nameProblems(name, pointer).concat(illFormedNames(item, pointerTo(pointer, name))),
      )
    : [];
}

function nameProblems(name: string, pointer: string): readonly Problem[] {
  return name.isWellFormed() ? [] : [{ pointer, detail: 'It has a name that is not well-formed Unicode text' }];
}

function duplicatedNames(document: JsonObject): readonly Problem[] {
  const top: TaskList = [field(document, 'do'), '/do'];
  return [top, ...allTaskEntries(...top).flatMap((entry) => nestedTaskLists(entry))].flatMap(
    ([list, pointer]: TaskList) => {
      const names = taskEntries(list, pointer).map(({ name }) => name);
      const duplicated = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
      return duplicated.length === 0
        ? []
        : [
            {
              pointer,
              detail: `The following task names are duplicated: ${duplicated.map((name) => `'${name}'`).join(', ')}.`,
            },
          ];
    },
  );
}

function connectionProblems(text: string): readonly Problem[] {
  const hydration = hydrated(text);
  if ('problems' in hydration) {
    return hydration.problems;
  }
  try {
    buildGraph(hydration.workflow);
    return [];
  } catch (error) {
    return [{ pointer: '', detail: `The steps of the workflow do not connect: ${messageOf(error)}` }];
  }
}

function hydrated(text: string): { readonly workflow: Workflow } | { readonly problems: readonly Problem[] } {
  try {
    return { workflow: Classes.Workflow.deserialize(text, { validate: false }) };
  } catch (error) {
    return { problems: [{ pointer: '', detail: messageOf(error) }] };
  }
}

function messageOf(error: unknown): string {
  return String(error).replace(/^\w*Error: /u, '');
}
