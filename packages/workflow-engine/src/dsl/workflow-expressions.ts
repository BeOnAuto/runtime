import { enclosedBody, expressionSource } from './expressions.ts';
import { entriesOf, field, isList, isObject, listField, objectField, textField } from './json.ts';
import type { Json, JsonEntry, JsonObject } from './json.ts';
import { eventFiltersOf, type LocatedFilter } from './task-policy.ts';
import { allTaskEntries, kindOf, pointerTo, taskEntries, type TaskEntry } from './tasks.ts';

export interface PlacedExpression {
  readonly pointer: string;
  readonly source: string;
  readonly names: readonly string[];
}

type Scope = readonly string[];

const rootNames: Scope = ['data', 'workflow', 'runtime'];

const taskNames: Scope = ['data', 'context', 'workflow', 'runtime', 'task'];

const filterNames: Scope = ['data'];

function placed(source: string, pointer: string, names: Scope): PlacedExpression {
  return { pointer, source, names: [...new Set(names)].map((name) => `$${name}`) };
}

function conditionAt(condition: Json | undefined, pointer: string, names: Scope): readonly PlacedExpression[] {
  return typeof condition === 'string' ? [placed(expressionSource(condition), pointer, names)] : [];
}

function templateAt(template: Json | undefined, pointer: string, names: Scope): readonly PlacedExpression[] {
  const body = enclosedBody(template);
  if (body !== undefined) {
    return [placed(body, pointer, names)];
  }
  if (isList(template)) {
    return template.flatMap((item, index) => templateAt(item, pointerTo(pointer, index), names));
  }
  return isObject(template)
    ? entriesOf(template).flatMap(([key, value]: JsonEntry) => templateAt(value, pointerTo(pointer, key), names))
    : [];
}

export function holdsAnExpression(template: Json): boolean {
  return templateAt(template, '', []).length > 0;
}

function transformAt(transform: Json | undefined, pointer: string, names: Scope): readonly PlacedExpression[] {
  return typeof transform === 'string' ? conditionAt(transform, pointer, names) : templateAt(transform, pointer, names);
}

function filtersAt(to: JsonObject, pointer: string): readonly PlacedExpression[] {
  return eventFiltersOf(to, pointer).flatMap(([filter, at]: LocatedFilter) =>
    isObject(filter) ? templateAt(field(filter, 'with'), `${at}/with`, filterNames) : [],
  );
}

function retryAt(retry: Json | undefined, pointer: string, names: Scope): readonly PlacedExpression[] {
  if (!isObject(retry)) {
    return [];
  }
  return conditionAt(field(retry, 'when'), `${pointer}/when`, names).concat(
    conditionAt(field(retry, 'exceptWhen'), `${pointer}/exceptWhen`, names),
    templateAt(field(retry, 'delay'), `${pointer}/delay`, names),
    templateAt(field(retry, 'jitter'), `${pointer}/jitter`, names),
    templateAt(field(retry, 'limit'), `${pointer}/limit`, names),
  );
}

function boundIn(object: JsonObject, key: string, otherwise: string): string {
  return textField(object, key) ?? otherwise;
}

function catchAt(task: JsonObject, reference: string, scope: Scope): readonly PlacedExpression[] {
  const handler = objectField(task, 'catch') ?? {};
  const pointer = `${reference}/catch`;
  const names = [...scope, ...taskNames, 'input', boundIn(handler, 'as', 'error')];
  return conditionAt(field(handler, 'when'), `${pointer}/when`, names).concat(
    conditionAt(field(handler, 'exceptWhen'), `${pointer}/exceptWhen`, names),
    retryAt(field(handler, 'retry'), `${pointer}/retry`, names),
    listAt(field(task, 'try'), `${reference}/try`, scope),
    listAt(field(handler, 'do'), `${pointer}/do`, [...scope, boundIn(handler, 'as', 'error')]),
  );
}

function forAt(task: JsonObject, reference: string, scope: Scope): readonly PlacedExpression[] {
  const loop = objectField(task, 'for') ?? {};
  const bound = [...scope, boundIn(loop, 'each', 'item'), boundIn(loop, 'at', 'index')];
  return conditionAt(field(loop, 'in'), `${reference}/for/in`, [...scope, ...taskNames, 'input']).concat(
    conditionAt(field(task, 'while'), `${reference}/while`, [...bound, ...taskNames, 'input']),
    listAt(field(task, 'do'), `${reference}/do`, bound),
  );
}

function switchAt(task: JsonObject, reference: string, names: Scope): readonly PlacedExpression[] {
  return (listField(task, 'switch') ?? []).flatMap((item, index) =>
    isObject(item)
      ? entriesOf(item).flatMap(([name, switchCase]: JsonEntry) =>
          isObject(switchCase)
            ? conditionAt(field(switchCase, 'when'), `${pointerTo(`${reference}/switch/${index}`, name)}/when`, names)
            : [],
        )
      : [],
  );
}

function bodyAt(entry: TaskEntry, scope: Scope): readonly PlacedExpression[] {
  const { task, reference } = entry;
  const names = [...scope, ...taskNames, 'input'];
  const listen = objectField(objectField(task, 'listen') ?? {}, 'to') ?? {};
  return templateAt(field(task, 'set'), `${reference}/set`, names).concat(
    templateAt(field(task, 'with'), `${reference}/with`, names),
    templateAt(field(task, 'wait'), `${reference}/wait`, names),
    templateAt(field(objectField(task, 'raise') ?? {}, 'error'), `${reference}/raise/error`, names),
    templateAt(
      field(objectField(objectField(task, 'emit') ?? {}, 'event') ?? {}, 'with'),
      `${reference}/emit/event/with`,
      names,
    ),
    switchAt(task, reference, names),
    filtersAt(listen, `${reference}/listen/to`),
  );
}

function nestedAt({ task, reference }: TaskEntry, scope: Scope): readonly PlacedExpression[] {
  const kind = kindOf(task);
  if (kind === 'for') {
    return forAt(task, reference, scope);
  }
  if (kind === 'try') {
    return catchAt(task, reference, scope);
  }
  const branches = field(objectField(task, 'fork') ?? {}, 'branches');
  return listAt(
    kind === 'do' ? field(task, 'do') : branches,
    kind === 'do' ? `${reference}/do` : `${reference}/fork/branches`,
    scope,
  );
}

function taskAt(entry: TaskEntry, scope: Scope): readonly PlacedExpression[] {
  const { task, reference } = entry;
  const names = [...scope, ...taskNames];
  return conditionAt(field(task, 'if'), `${reference}/if`, names).concat(
    templateAt(field(objectField(task, 'timeout') ?? {}, 'after'), `${reference}/timeout/after`, names),
    transformAt(field(objectField(task, 'input') ?? {}, 'from'), `${reference}/input/from`, names),
    bodyAt(entry, scope),
    transformAt(field(objectField(task, 'output') ?? {}, 'as'), `${reference}/output/as`, [...names, 'input']),
    transformAt(field(objectField(task, 'export') ?? {}, 'as'), `${reference}/export/as`, [
      ...names,
      'input',
      'output',
    ]),
    nestedAt(entry, scope),
  );
}

function listAt(list: Json | undefined, pointer: string, scope: Scope): readonly PlacedExpression[] {
  return taskEntries(list, pointer).flatMap((entry) => taskAt(entry, scope));
}

function componentsAt(use: JsonObject, names: Scope): readonly PlacedExpression[] {
  const retries = entriesOf(objectField(use, 'retries') ?? {}).flatMap(([name, policy]: JsonEntry) =>
    retryAt(policy, pointerTo('/use/retries', name), names),
  );
  return retries.concat(
    templateAt(objectField(use, 'timeouts'), '/use/timeouts', names),
    templateAt(objectField(use, 'errors'), '/use/errors', names),
  );
}

function scheduleAt(schedule: JsonObject): readonly PlacedExpression[] {
  const on = objectField(schedule, 'on') ?? {};
  return eventFiltersOf(on, '/schedule/on').flatMap(([filter, at]: LocatedFilter) =>
    isObject(filter) ? templateAt(field(filter, 'with'), `${at}/with`, filterNames) : [],
  );
}

function boundNamesOf({ task }: TaskEntry): Scope {
  const loop = objectField(task, 'for') ?? {};
  const handler = objectField(task, 'catch') ?? {};
  return [textField(loop, 'each'), textField(loop, 'at'), textField(handler, 'as')].flatMap((name) =>
    name === undefined ? [] : [name],
  );
}

function boundNamesIn(document: JsonObject): Scope {
  return [
    'item',
    'index',
    'error',
    ...allTaskEntries(field(document, 'do'), '/do').flatMap((entry) => boundNamesOf(entry)),
  ];
}

export function workflowExpressionsOf(document: JsonObject): readonly PlacedExpression[] {
  const input = objectField(document, 'input') ?? {};
  const output = objectField(document, 'output') ?? {};
  const components = [...taskNames, 'input', 'output', ...boundNamesIn(document)];
  return transformAt(field(input, 'from'), '/input/from', rootNames).concat(
    templateAt(field(objectField(document, 'timeout') ?? {}, 'after'), '/timeout/after', rootNames),
    transformAt(field(output, 'as'), '/output/as', [...rootNames, 'context']),
    componentsAt(objectField(document, 'use') ?? {}, components),
    scheduleAt(objectField(document, 'schedule') ?? {}),
    listAt(field(document, 'do'), '/do', []),
  );
}
