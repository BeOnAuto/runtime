import { EventSourceSchema } from '@on.auto/definitions';
import {
  allTaskEntries,
  enclosedBody,
  entriesOf,
  eventFiltersOf,
  field,
  isList,
  isObject,
  objectField,
  pointerTo,
  type Json,
  type JsonEntry,
  type JsonObject,
  type LocatedFilter,
} from '@on.auto/workflow-engine';
import { Schema } from 'effect';

const takenByTheDsl = /^[A-Za-z][A-Za-z0-9+\-.]*:\/\//u;

const isEventSource = Schema.is(EventSourceSchema);

function filtersIn(document: JsonObject): readonly LocatedFilter[] {
  const on = objectField(objectField(document, 'schedule') ?? {}, 'on');
  const listened = allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) => {
    const to = objectField(objectField(task, 'listen') ?? {}, 'to');
    return to === undefined ? [] : eventFiltersOf(to, `${reference}/listen/to`);
  });
  return [...(on === undefined ? [] : eventFiltersOf(on, '/schedule/on')), ...listened];
}

function isAReferenceTheDslRefuses(source: Json | undefined): boolean {
  return (
    typeof source === 'string' &&
    enclosedBody(source) === undefined &&
    !takenByTheDsl.test(source) &&
    isEventSource(source)
  );
}

function sourcesReadAsReferences(document: JsonObject): ReadonlySet<string> {
  return new Set(
    filtersIn(document).flatMap(([filter, pointer]: LocatedFilter) => {
      const source = field(objectField(isObject(filter) ? filter : {}, 'with') ?? {}, 'source');
      return isAReferenceTheDslRefuses(source) ? [`${pointer}/with/source`] : [];
    }),
  );
}

function withoutAt(value: Json, pointer: string, left: ReadonlySet<string>): Json {
  if (isList(value)) {
    return value.map((item, index) => withoutAt(item, pointerTo(pointer, index), left));
  }
  return isObject(value) ? withoutIn(value, pointer, left) : value;
}

function withoutIn(object: JsonObject, pointer: string, left: ReadonlySet<string>): JsonObject {
  return Object.fromEntries(
    entriesOf(object).flatMap(([key, item]: JsonEntry) => {
      const at = pointerTo(pointer, key);
      return left.has(at) ? [] : [[key, withoutAt(item, at, left)]];
    }),
  );
}

export function withoutSourcesReadAsReferences(document: JsonObject): JsonObject {
  const left = sourcesReadAsReferences(document);
  return left.size === 0 ? document : withoutIn(document, '', left);
}
