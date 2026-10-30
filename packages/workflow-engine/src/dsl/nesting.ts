import { entriesOf, field, isList, isObject, mostValueDepth, type Json, type JsonObject } from './json.ts';
import { forbidden, type Rejection } from './policy-checks.ts';
import { nestedTaskLists, pointerTo, taskEntries, type TaskEntry } from './tasks.ts';

const mostTaskNesting = 64;

export function nestingRejections(document: JsonObject): readonly Rejection[] {
  const deepValue = deepValueIn(document, '', mostValueDepth);
  if (deepValue !== undefined) {
    return [forbidden(deepValue, `The document nests values more than ${mostValueDepth} levels deep`)];
  }
  const deepList = deepTaskListIn(field(document, 'do'), '/do', mostTaskNesting);
  return deepList === undefined
    ? []
    : [forbidden(deepList, `The document nests tasks more than ${mostTaskNesting} levels deep`)];
}

function deepValueIn(value: Json, pointer: string, room: number): string | undefined {
  if (!isList(value) && !isObject(value)) {
    return undefined;
  }
  if (room === 0) {
    return pointer;
  }
  const children: readonly (readonly [Json, string])[] = isList(value)
    ? value.map((item, index): readonly [Json, string] => [item, pointerTo(pointer, index)])
    : entriesOf(value).map(([key, item]): readonly [Json, string] => [item, pointerTo(pointer, key)]);
  return firstFound(children, ([child, at]) => deepValueIn(child, at, room - 1));
}

function deepTaskListIn(list: Json | undefined, pointer: string, room: number): string | undefined {
  if (!isList(list)) {
    return undefined;
  }
  return room === 0 ? pointer : firstFound(taskEntries(list, pointer), (entry) => deepTaskListUnder(entry, room - 1));
}

function deepTaskListUnder(entry: TaskEntry, room: number): string | undefined {
  return firstFound(nestedTaskLists(entry), ([list, at]) => deepTaskListIn(list, at, room));
}

function firstFound<T>(items: readonly T[], find: (item: T) => string | undefined): string | undefined {
  for (const item of items) {
    const found = find(item);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
