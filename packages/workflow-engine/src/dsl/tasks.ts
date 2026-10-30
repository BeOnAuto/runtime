import { entriesOf, field, isList, isObject, objectField, valueAtPointer, type Json, type JsonObject } from './json.ts';

export const taskKinds = [
  'for',
  'try',
  'call',
  'fork',
  'emit',
  'listen',
  'raise',
  'run',
  'set',
  'switch',
  'wait',
  'do',
] as const;

export type TaskKind = (typeof taskKinds)[number];

export interface TaskEntry {
  readonly name: string;
  readonly task: JsonObject;
  readonly reference: string;
}

export type TaskList = readonly [Json | undefined, string];

export interface TaskType {
  readonly kind: TaskKind;
  readonly configuration: Json;
}

export function kindOf(task: JsonObject): TaskKind | undefined {
  return typeOf(task)?.kind;
}

export function typeOf(task: JsonObject): TaskType | undefined {
  for (const kind of taskKinds) {
    const configuration = field(task, kind);
    if (configuration !== undefined) {
      return { kind, configuration };
    }
  }
  return undefined;
}

export function pointerTo(parent: string, key: string | number): string {
  return `${parent}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

export function taskEntries(list: Json | undefined, pointer: string): readonly TaskEntry[] {
  if (!isList(list)) {
    return [];
  }
  return list.flatMap((item, index) =>
    isObject(item)
      ? entriesOf(item).flatMap(([name, task]) =>
          isObject(task) ? [{ name, task, reference: pointerTo(pointerTo(pointer, index), name) }] : [],
        )
      : [],
  );
}

export function nestedTaskLists({ task, reference }: TaskEntry): readonly TaskList[] {
  const kind = kindOf(task);
  return [
    [kind === 'do' || kind === 'for' ? field(task, 'do') : undefined, `${reference}/do`],
    [kind === 'try' ? field(task, 'try') : undefined, `${reference}/try`],
    [kind === 'try' ? field(objectField(task, 'catch') ?? {}, 'do') : undefined, `${reference}/catch/do`],
    [kind === 'fork' ? field(objectField(task, 'fork') ?? {}, 'branches') : undefined, `${reference}/fork/branches`],
  ];
}

export function allTaskEntries(list: Json | undefined, pointer: string): readonly TaskEntry[] {
  return taskEntries(list, pointer).flatMap((entry) =>
    [entry].concat(nestedTaskLists(entry).flatMap(([nested, at]: TaskList) => allTaskEntries(nested, at))),
  );
}

const stepReference = /^(?:\/(?:do|try|catch\/do|fork\/branches)\/\d+\/[^/]+)+/u;

export function stepNamedAt(pointer: string): string | undefined {
  const reference = stepReference.exec(pointer)?.[0];
  return reference === undefined ? undefined : taskNameOf(reference);
}

export function taskNameOf(reference: string): string {
  return reference
    .slice(reference.lastIndexOf('/') + 1)
    .replaceAll('~1', '/')
    .replaceAll('~0', '~');
}

export function entryAt(document: JsonObject, reference: string): TaskEntry {
  const task = valueAtPointer(document, reference);
  return { name: taskNameOf(reference), task: isObject(task) ? task : {}, reference };
}
